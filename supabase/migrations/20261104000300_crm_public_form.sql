-- AXBI CRM: formulário público de captação com consentimento LGPD,
-- campo-armadilha antispam e limites de envio.
--
-- O navegador anônimo NÃO tem acesso às tabelas. Ele só pode chamar
-- crm_public_form_info e crm_submit_public_lead, que validam tudo no banco.

alter table public.crm_leads add column if not exists origin text not null default 'manual'
  check (origin in ('manual', 'public_form', 'import'));
alter table public.crm_leads add column if not exists consent_at timestamptz;
alter table public.crm_leads add column if not exists consent_text text
  check (consent_text is null or length(consent_text) <= 1000);

alter table public.crm_organizations add column if not exists privacy_policy_url text
  check (privacy_policy_url is null or privacy_policy_url ~ '^https://');

create table if not exists public.crm_form_submissions (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.crm_organizations (id) on delete cascade,
  email_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists crm_form_submissions_rate_idx
  on public.crm_form_submissions (organization_id, created_at);
create index if not exists crm_form_submissions_email_idx
  on public.crm_form_submissions (organization_id, email_hash, created_at);

alter table public.crm_form_submissions enable row level security;
revoke all on public.crm_form_submissions from anon, authenticated;
-- Sem políticas: só funções security definer acessam esta tabela.

create or replace function public.crm_public_form_info(p_slug text)
returns table (name text, privacy_policy_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name, o.privacy_policy_url
  from public.crm_organizations o
  where o.slug = lower(btrim(p_slug)) and o.public_form_enabled;
$$;

create or replace function public.crm_submit_public_lead(
  p_slug text,
  p_name text,
  p_email text,
  p_phone text,
  p_company text,
  p_pain text,
  p_consent boolean,
  p_consent_text text,
  p_website text default '',   -- campo-armadilha: humanos deixam vazio
  p_campaign text default ''
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_hash text;
begin
  select o.id into v_org from public.crm_organizations o
  where o.slug = lower(btrim(p_slug)) and o.public_form_enabled;
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
  if coalesce(length(btrim(p_consent_text)), 0) not between 10 and 1000 then
    raise exception 'Texto de consentimento inválido.';
  end if;
  if coalesce(length(btrim(p_name)), 0) not between 2 and 200 then
    raise exception 'Informe seu nome.';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(v_email) > 320 then
    raise exception 'Informe um e-mail válido.';
  end if;
  if length(coalesce(p_phone, '')) > 40 or length(coalesce(p_company, '')) > 200
     or length(coalesce(p_pain, '')) > 2000 or length(coalesce(p_campaign, '')) > 200 then
    raise exception 'Algum campo excede o tamanho permitido.';
  end if;

  v_hash := md5(v_org::text || ':' || v_email);

  -- Limites: 3 envios por e-mail por dia e 60 envios por organização por hora.
  if (select count(*) from public.crm_form_submissions s
      where s.organization_id = v_org and s.email_hash = v_hash
        and s.created_at > now() - interval '1 day') >= 3 then
    raise exception 'Recebemos seus dados. Aguarde nosso contato.';
  end if;
  if (select count(*) from public.crm_form_submissions s
      where s.organization_id = v_org and s.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Muitos envios no momento. Tente novamente mais tarde.';
  end if;

  insert into public.crm_form_submissions (organization_id, email_hash) values (v_org, v_hash);

  insert into public.crm_leads (
    organization_id, name, email, phone, company, pain, campaign, source, stage, origin,
    consent_at, consent_text, next_action, next_action_date, created_by
  ) values (
    v_org, btrim(p_name), v_email, btrim(coalesce(p_phone, '')), btrim(coalesce(p_company, '')),
    btrim(coalesce(p_pain, '')), btrim(coalesce(p_campaign, '')), 'Formulário público', 'Novo lead',
    'public_form', now(), btrim(p_consent_text), 'Primeiro contato', current_date, null
  );
  return true;
end;
$$;

-- Limpeza de registros antigos de controle de envio (pode ser agendada com pg_cron).
create or replace function public.crm_purge_form_submissions()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.crm_form_submissions where created_at < now() - interval '7 days';
$$;

revoke all on function public.crm_public_form_info(text) from public;
revoke all on function public.crm_submit_public_lead(text, text, text, text, text, text, boolean, text, text, text) from public;
revoke all on function public.crm_purge_form_submissions() from public, anon, authenticated;
grant execute on function public.crm_public_form_info(text) to anon, authenticated;
grant execute on function public.crm_submit_public_lead(text, text, text, text, text, text, boolean, text, text, text) to anon, authenticated;
