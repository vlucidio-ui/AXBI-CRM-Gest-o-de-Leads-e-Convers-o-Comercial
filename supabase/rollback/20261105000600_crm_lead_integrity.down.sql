-- Reversão de 20261105000600 (somente bancos de teste).
drop trigger if exists crm_leads_protect_fields on public.crm_leads;
drop function if exists public.crm_protect_lead_fields();
drop trigger if exists crm_organizations_protect_fields on public.crm_organizations;
drop function if exists public.crm_protect_org_fields();
drop function if exists public.crm_purge_member_lookups();
drop function if exists public.crm_add_member_by_email(uuid, text, text);
create function public.crm_add_member_by_email(p_org uuid, p_email text, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_target uuid;
begin
  if p_role not in ('admin', 'member', 'viewer') then raise exception 'Papel inválido.'; end if;
  if not public.crm_has_role(p_org, array['owner', 'admin']) then
    raise exception 'Sem permissão para gerenciar membros.' using errcode = '42501';
  end if;
  select u.id into v_target from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_target is null then raise exception 'Usuário não encontrado. Peça para a pessoa criar a conta primeiro.'; end if;
  if exists (select 1 from public.crm_members m where m.organization_id = p_org and m.user_id = v_target and m.role = 'owner') then
    raise exception 'O papel de um proprietário não pode ser alterado por aqui.';
  end if;
  insert into public.crm_members (organization_id, user_id, role) values (p_org, v_target, p_role)
  on conflict (organization_id, user_id) do update set role = excluded.role;
end $$;
revoke all on function public.crm_add_member_by_email(uuid, text, text) from public, anon;
grant execute on function public.crm_add_member_by_email(uuid, text, text) to authenticated;
drop schema if exists crm_private cascade;
-- crm_keep_one_owner permanece na versão com trava (compatível com a anterior).
