-- AXBI CRM: integridade de autoria, origem e consentimento; proprietário sob concorrência;
-- limite de consultas de e-mail no convite.
-- Reversão: supabase/rollback/20261105000600_crm_lead_integrity.down.sql
--
-- Quem chama pela API (papéis anon/authenticated) não define autoria, data de criação, origem
-- "formulário público" nem dados de consentimento: o banco preenche e depois congela esses campos.
-- Funções security definer (formulário público) e o administrador do banco (importações via SQL)
-- rodam com outro current_user e não passam por esta regra.

create schema if not exists crm_private;
revoke all on schema crm_private from public, anon, authenticated;

create or replace function public.crm_protect_lead_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    if new.origin = 'public_form' or new.consent_at is not null or new.consent_text is not null then
      raise exception 'Leads do formulário público só podem ser criados pelo formulário.' using errcode = '42501';
    end if;
  else
    if new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
       or new.origin is distinct from old.origin or new.consent_at is distinct from old.consent_at
       or new.consent_text is distinct from old.consent_text then
      raise exception 'Autoria, origem e consentimento do lead não podem ser alterados.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.crm_protect_lead_fields() from public, anon, authenticated;

drop trigger if exists crm_leads_protect_fields on public.crm_leads;
create trigger crm_leads_protect_fields
  before insert or update on public.crm_leads
  for each row execute function public.crm_protect_lead_fields();

-- Quem criou a organização (usado no limite de organizações por usuário) não pode ser trocado pela API.
create or replace function public.crm_protect_org_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated')
     and (new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
          or new.id is distinct from old.id) then
    raise exception 'Criador e data de criação da organização não podem ser alterados.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.crm_protect_org_fields() from public, anon, authenticated;

drop trigger if exists crm_organizations_protect_fields on public.crm_organizations;
create trigger crm_organizations_protect_fields
  before update on public.crm_organizations
  for each row execute function public.crm_protect_org_fields();

-- Proprietário único sob concorrência: trava a organização antes de contar os proprietários,
-- para que dois rebaixamentos simultâneos não deixem a organização sem dono.
create or replace function public.crm_keep_one_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    -- Exclusão em cascata da organização inteira é permitida.
    perform 1 from public.crm_organizations o where o.id = old.organization_id for update;
    if not found then
      return coalesce(new, old);
    end if;
    if not exists (
      select 1 from public.crm_members m
      where m.organization_id = old.organization_id and m.role = 'owner' and m.user_id <> old.user_id
    ) then
      raise exception 'A organização precisa de pelo menos um proprietário.';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.crm_keep_one_owner() from public, anon, authenticated;

-- Convite por e-mail: no máximo 20 consultas por usuário por hora (dificulta descobrir
-- quais e-mails têm conta). Registro atômico por usuário.
create table if not exists crm_private.member_lookups (
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists member_lookups_user_idx on crm_private.member_lookups (user_id, created_at);
revoke all on crm_private.member_lookups from public, anon, authenticated;

-- Retorna 'added' ou 'not_found' (em vez de erro) para que a tentativa fique registrada mesmo
-- quando o e-mail não existe: um erro desfaria a transação e o registro da consulta.
drop function if exists public.crm_add_member_by_email(uuid, text, text);
create function public.crm_add_member_by_email(p_org uuid, p_email text, p_role text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_target uuid;
begin
  if p_role not in ('admin', 'member', 'viewer') then
    raise exception 'Papel inválido.';
  end if;
  if not public.crm_has_role(p_org, array['owner', 'admin']) then
    raise exception 'Sem permissão para gerenciar membros.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('crm_member_lookup:' || v_user::text, 0));
  if (select count(*) from crm_private.member_lookups l
      where l.user_id = v_user and l.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Muitas tentativas de convite. Tente novamente mais tarde.';
  end if;
  insert into crm_private.member_lookups (user_id) values (v_user);
  select u.id into v_target from auth.users u where lower(u.email) = lower(btrim(coalesce(p_email, '')));
  if v_target is null then
    return 'not_found';
  end if;
  if exists (select 1 from public.crm_members m where m.organization_id = p_org and m.user_id = v_target and m.role = 'owner') then
    raise exception 'O papel de um proprietário não pode ser alterado por aqui.';
  end if;
  insert into public.crm_members (organization_id, user_id, role)
  values (p_org, v_target, p_role)
  on conflict (organization_id, user_id) do update set role = excluded.role;
  return 'added';
end;
$$;
revoke all on function public.crm_add_member_by_email(uuid, text, text) from public, anon;
grant execute on function public.crm_add_member_by_email(uuid, text, text) to authenticated;

-- Limpeza do registro de consultas (pode ser agendada com pg_cron junto de crm_purge_form_submissions).
create or replace function public.crm_purge_member_lookups()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from crm_private.member_lookups where created_at < now() - interval '1 day';
$$;
revoke all on function public.crm_purge_member_lookups() from public, anon, authenticated;
