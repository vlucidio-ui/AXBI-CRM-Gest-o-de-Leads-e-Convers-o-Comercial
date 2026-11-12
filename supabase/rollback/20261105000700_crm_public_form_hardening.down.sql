-- Reversão de 20261105000700 (somente bancos de teste). Volta ao formulário de 20261104000400
-- (reaplique aquela migration depois desta reversão para recriar crm_submit_public_lead e crm_public_form_info antigos).
drop function if exists public.crm_submit_public_lead(text, text, text, text, text, text, boolean, text, text, text, text, text, text);
drop function if exists public.crm_public_form_info(text);
drop function if exists public.crm_consent_for(text);
drop table if exists public.crm_consent_records;
drop table if exists public.crm_consent_terms;
drop index if exists public.crm_form_submissions_ip_idx;
alter table public.crm_form_submissions drop column if exists ip_hash;
alter table public.crm_leads drop column if exists consent_version, drop column if exists consent_purpose;
alter table public.crm_organizations drop column if exists privacy_policy_version;
drop table if exists crm_private.settings;
create or replace function public.crm_public_form_info(p_slug text)
returns table (name text, privacy_policy_url text) language sql stable security definer set search_path = '' as $$
  select o.name, o.privacy_policy_url from public.crm_organizations o where o.slug = lower(btrim(p_slug)) and o.public_form_enabled;
$$;
revoke all on function public.crm_public_form_info(text) from public;
grant execute on function public.crm_public_form_info(text) to anon, authenticated;
