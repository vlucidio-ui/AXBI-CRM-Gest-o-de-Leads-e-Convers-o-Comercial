-- AXBI CRM: formulário público endurecido.
--  1. Só aceita envios que passaram pelo servidor do CRM (/api/public-lead), que valida o CAPTCHA
--     (Cloudflare Turnstile). O servidor prova isso com uma chave de gateway cujo SHA-256 fica em
--     crm_private.settings; a chave pública (anon) sozinha não envia mais leads.
--  2. Limites atômicos (trava por organização): 3/dia por contato, 60/hora por organização e
--     10/hora por IP. O IP chega como HMAC-SHA256 calculado no servidor (nunca em texto aberto).
--  3. Consentimento LGPD com texto e versão definidos no banco (crm_consent_terms); o texto enviado
--     pelo navegador é ignorado. Cada consentimento gera um registro em crm_consent_records.
-- AÇÃO ADMINISTRATIVA (depois de aplicar; sem ela o formulário fica indisponível, por segurança):
--   insert into crm_private.settings (key, value)
--   values ('form_gateway_sha256', encode(sha256(convert_to('<CRM_FORM_GATEWAY_SECRET>', 'UTF8')), 'hex'))
--   on conflict (key) do update set value = excluded.value;
-- Reversão: supabase/rollback/20261105000700_crm_public_form_hardening.down.sql

create table if not exists crm_private.settings (
  key text primary key,
  value text not null
);
revoke all on crm_private.settings from public, anon, authenticated;

-- Termos de consentimento versionados ({organizacao} é trocado pelo nome da organização).
create table if not exists public.crm_consent_terms (
  version text primary key check (version ~ '^[0-9A-Za-z._-]{1,40}$'),
  purpose text not null check (length(btrim(purpose)) between 10 and 300),
  text_template text not null check (length(btrim(text_template)) between 20 and 1000 and position('{organizacao}' in text_template) > 0),
  active boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists crm_consent_terms_one_active on public.crm_consent_terms (active) where active;
alter table public.crm_consent_terms enable row level security;
revoke all on public.crm_consent_terms from anon, authenticated;
grant select on public.crm_consent_terms to authenticated;
drop policy if exists crm_consent_terms_select on public.crm_consent_terms;
create policy crm_consent_terms_select on public.crm_consent_terms for select to authenticated using (true);

insert into public.crm_consent_terms (version, purpose, text_template, active) values (
  '2026-11-05',
  'Contato comercial sobre os serviços da organização, a partir dos dados enviados no formulário.',
  'Autorizo {organizacao} a usar meus dados (nome, e-mail, telefone, empresa e mensagem) para entrar em contato sobre seus serviços, conforme a LGPD. Posso pedir a exclusão a qualquer momento.',
  true
) on conflict (version) do nothing;

alter table public.crm_organizations add column if not exists privacy_policy_version text
  check (privacy_policy_version is null or length(privacy_policy_version) between 1 and 40);

alter table public.crm_leads add column if not exists consent_version text;
alter table public.crm_leads add column if not exists consent_purpose text;

-- Prova de consentimento: só acréscimo; sobrevive à exclusão do lead (fica sem dados pessoais).
create table if not exists public.crm_consent_records (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.crm_organizations (id) on delete cascade,
  lead_id uuid references public.crm_leads (id) on delete set null,
  term_version text not null references public.crm_consent_terms (version),
  purpose text not null,
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  privacy_policy_url text,
  privacy_policy_version text,
  consented_at timestamptz not null default now()
);
create index if not exists crm_consent_records_org_idx on public.crm_consent_records (organization_id, consented_at);
create index if not exists crm_consent_records_lead_idx on public.crm_consent_records (lead_id);
alter table public.crm_consent_records enable row level security;
revoke all on public.crm_consent_records from anon, authenticated;
grant select on public.crm_consent_records to authenticated;
drop policy if exists crm_consent_records_select on public.crm_consent_records;
create policy crm_consent_records_select on public.crm_consent_records
  for select to authenticated using (public.crm_is_member(organization_id));

-- Os campos de consentimento novos também ficam congelados para a API.
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
    if new.origin = 'public_form' or new.consent_at is not null or new.consent_text is not null
       or new.consent_version is not null or new.consent_purpose is not null then
      raise exception 'Leads do formulário público só podem ser criados pelo formulário.' using errcode = '42501';
    end if;
  else
    if new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
       or new.origin is distinct from old.origin or new.consent_at is distinct from old.consent_at
       or new.consent_text is distinct from old.consent_text or new.consent_version is distinct from old.consent_version
       or new.consent_purpose is distinct from old.consent_purpose then
      raise exception 'Autoria, origem e consentimento do lead não podem ser alterados.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.crm_protect_lead_fields() from public, anon, authenticated;

alter table public.crm_form_submissions add column if not exists ip_hash text
  check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$');
create index if not exists crm_form_submissions_ip_idx
  on public.crm_form_submissions (organization_id, ip_hash, created_at);

-- Texto oficial de consentimento para a organização (usado pela página e pelo envio).
create or replace function public.crm_consent_for(p_org_name text)
returns table (version text, purpose text, consent_text text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.version, t.purpose, replace(t.text_template, '{organizacao}', p_org_name)
  from public.crm_consent_terms t where t.active;
$$;
revoke all on function public.crm_consent_for(text) from public, anon, authenticated;

drop function if exists public.crm_public_form_info(text);
create function public.crm_public_form_info(p_slug text)
returns table (name text, privacy_policy_url text, consent_text text, consent_version text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name, o.privacy_policy_url, c.consent_text, c.version
  from public.crm_organizations o
  cross join lateral public.crm_consent_for(o.name) c
  where o.slug = lower(btrim(p_slug)) and o.public_form_enabled;
$$;
revoke all on function public.crm_public_form_info(text) from public;
grant execute on function public.crm_public_form_info(text) to anon, authenticated;

-- A versão antiga (chamável só com a chave pública, texto de consentimento vindo do navegador) sai.
drop function if exists public.crm_submit_public_lead(text, text, text, text, text, text, boolean, text, text, text, text);

create function public.crm_submit_public_lead(
  p_slug text,
  p_name text,
  p_email text,
  p_phone text,
  p_company text,
  p_pain text,
  p_consent boolean,
  p_consent_version text,
  p_website text,       -- campo-armadilha: humanos deixam vazio
  p_campaign text,
  p_notes text,
  p_gateway_key text,   -- prova de que o envio passou pelo servidor do CRM (CAPTCHA validado)
  p_ip_hash text        -- HMAC-SHA256 do IP do visitante, calculado no servidor
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected text;
  v_org uuid;
  v_org_name text;
  v_policy_url text;
  v_policy_version text;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_hash text;
  v_term record;
  v_lead uuid;
begin
  select s.value into v_expected from crm_private.settings s where s.key = 'form_gateway_sha256';
  if v_expected is null or p_gateway_key is null or length(p_gateway_key) < 32
     or encode(sha256(convert_to(p_gateway_key, 'UTF8')), 'hex') <> v_expected then
    raise exception 'Formulário indisponível.' using errcode = '42501';
  end if;
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Formulário indisponível.' using errcode = '42501';
  end if;

  select o.id, o.name, o.privacy_policy_url, o.privacy_policy_version
    into v_org, v_org_name, v_policy_url, v_policy_version
  from public.crm_organizations o
  where o.slug = lower(btrim(coalesce(p_slug, ''))) and o.public_form_enabled;
  if v_org is null then
    raise exception 'Formulário indisponível.';
  end if;

  -- Robôs preenchem o campo oculto: fingimos sucesso e descartamos.
  if coalesce(btrim(p_website), '') <> '' then
    return true;
  end if;

  if p_consent is distinct from true then
    raise exception 'É necessário aceitar o tratamento dos dados para enviar.';
  end if;
  select * into v_term from public.crm_consent_for(v_org_name);
  if v_term.version is null then
    raise exception 'Formulário indisponível.';
  end if;
  if p_consent_version is distinct from v_term.version then
    raise exception 'O texto de autorização foi atualizado. Recarregue a página e confirme novamente.';
  end if;
  if coalesce(length(btrim(p_name)), 0) not between 2 and 200 then
    raise exception 'Informe seu nome.';
  end if;
  if v_email <> '' and (v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(v_email) > 320) then
    raise exception 'Informe um e-mail válido.';
  end if;
  if v_phone <> '' and length(v_digits) not between 10 and 13 then
    raise exception 'Informe um WhatsApp válido, com DDD.';
  end if;
  if v_email = '' and v_phone = '' then
    raise exception 'Informe seu WhatsApp ou e-mail.';
  end if;
  if length(v_phone) > 40 or length(coalesce(p_company, '')) > 200
     or length(coalesce(p_pain, '')) > 2000 or length(coalesce(p_campaign, '')) > 200
     or length(coalesce(p_notes, '')) > 1000 then
    raise exception 'Algum campo excede o tamanho permitido.';
  end if;

  v_hash := md5(v_org::text || ':' || case when v_email <> '' then v_email else 'tel:' || v_digits end);

  -- Limites atômicos: envios simultâneos da mesma organização esperam a vez (trava da transação).
  perform pg_advisory_xact_lock(hashtextextended('crm_public_form:' || v_org::text, 0));
  if (select count(*) from public.crm_form_submissions s
      where s.organization_id = v_org and s.email_hash = v_hash
        and s.created_at > now() - interval '1 day') >= 3 then
    raise exception 'Recebemos seus dados. Aguarde nosso contato.';
  end if;
  if (select count(*) from public.crm_form_submissions s
      where s.organization_id = v_org and s.ip_hash = p_ip_hash
        and s.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Muitos envios no momento. Tente novamente mais tarde.';
  end if;
  if (select count(*) from public.crm_form_submissions s
      where s.organization_id = v_org and s.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Muitos envios no momento. Tente novamente mais tarde.';
  end if;

  insert into public.crm_form_submissions (organization_id, email_hash, ip_hash) values (v_org, v_hash, p_ip_hash);

  insert into public.crm_leads (
    organization_id, name, email, phone, company, pain, campaign, source, stage, origin,
    consent_at, consent_text, consent_version, consent_purpose, notes, next_action, next_action_date, created_by
  ) values (
    v_org, btrim(p_name), v_email, v_phone, btrim(coalesce(p_company, '')),
    btrim(coalesce(p_pain, '')), btrim(coalesce(p_campaign, '')), 'Formulário público', 'Novo lead',
    'public_form', now(), v_term.consent_text, v_term.version, v_term.purpose, btrim(coalesce(p_notes, '')),
    'Primeiro contato', current_date, null
  ) returning id into v_lead;

  insert into public.crm_consent_records (organization_id, lead_id, term_version, purpose, text_sha256,
    privacy_policy_url, privacy_policy_version)
  values (v_org, v_lead, v_term.version, v_term.purpose,
    encode(sha256(convert_to(v_term.consent_text, 'UTF8')), 'hex'), v_policy_url, v_policy_version);
  return true;
end;
$$;

revoke all on function public.crm_submit_public_lead(text, text, text, text, text, text, boolean, text, text, text, text, text, text) from public;
grant execute on function public.crm_submit_public_lead(text, text, text, text, text, text, boolean, text, text, text, text, text, text) to anon, authenticated;
