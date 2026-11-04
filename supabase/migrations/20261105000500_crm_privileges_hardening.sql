-- AXBI CRM: menor privilégio nas tabelas e funções.
-- No Supabase, tabelas novas em public recebem ALL (inclusive TRUNCATE, TRIGGER e REFERENCES) para
-- anon e authenticated por privilégio padrão. TRUNCATE ignora o RLS, então removemos tudo e
-- concedemos de volta só o que cada tabela precisa. Não altera dados.
-- Reversão: supabase/rollback/20261105000500_crm_privileges_hardening.down.sql

revoke all on public.crm_leads, public.crm_organizations, public.crm_members,
  public.crm_stage_history, public.crm_form_submissions from anon, authenticated;

grant select, insert, update, delete on public.crm_leads to authenticated;
grant select, update on public.crm_organizations to authenticated;
grant select, insert, update, delete on public.crm_members to authenticated;
grant select on public.crm_stage_history to authenticated;
-- crm_form_submissions: nenhum acesso direto (só funções security definer).

-- Funções auxiliares e de gatilho não precisam ser chamáveis pela API.
revoke all on function public.crm_slugify(text) from public, anon, authenticated;
revoke all on function public.crm_touch_updated_at() from public, anon, authenticated;
revoke all on function public.crm_lock_lead_org() from public, anon, authenticated;
