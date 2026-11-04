-- AXBI CRM: formulário público aceita WhatsApp OU e-mail (o site da AXBI pede só WhatsApp)
-- e guarda informações extras (ex.: regime tributário) nas observações do lead.
-- Substitui crm_submit_public_lead mantendo os mesmos nomes de parâmetro.

drop function if exists public.crm_submit_public_lead(text, text, text, text, text, text, boolean, text, text, text);

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
  p_campaign text default '',
  p_notes text default ''      -- informações extras do formulário (ex.: regime tributário)
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
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

  -- Limite por contato: usa o e-mail quando houver; senão, os dígitos do WhatsApp.
  v_hash := md5(v_org::text || ':' || case when v_email <> '' then v_email else 'tel:' || v_digits end);

  -- Limites: 3 envios por contato por dia e 60 envios por organização por hora.
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
    consent_at, consent_text, notes, next_action, next_action_date, created_by
  ) values (
    v_org, btrim(p_name), v_email, v_phone, btrim(coalesce(p_company, '')),
    btrim(coalesce(p_pain, '')), btrim(coalesce(p_campaign, '')), 'Formulário público', 'Novo lead',
    'public_form', now(), btrim(p_consent_text), btrim(coalesce(p_notes, '')),
    'Primeiro contato', current_date, null
  );
  return true;
end;
$$;

revoke all on function public.crm_submit_public_lead(text, text, text, text, text, text, boolean, text, text, text, text) from public;
grant execute on function public.crm_submit_public_lead(text, text, text, text, text, text, boolean, text, text, text, text) to anon, authenticated;
