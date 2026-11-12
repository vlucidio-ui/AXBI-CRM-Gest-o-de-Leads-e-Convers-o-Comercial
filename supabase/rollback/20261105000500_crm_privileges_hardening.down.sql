-- Reversão de 20261105000500 (somente bancos de teste): devolve os privilégios anteriores.
grant all on public.crm_leads, public.crm_organizations, public.crm_members, public.crm_stage_history to authenticated;
grant execute on function public.crm_slugify(text), public.crm_touch_updated_at(), public.crm_lock_lead_org() to public;
