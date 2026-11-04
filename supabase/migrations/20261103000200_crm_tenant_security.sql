-- AXBI CRM: organizações, membros, papéis, isolamento por organização (RLS)
-- e histórico de mudança de etapa. Pressupõe Supabase Auth (schema auth).
--
-- Papéis:
--   owner  – tudo, inclusive gerenciar administradores
--   admin  – gerencia membros (exceto owners), configura a organização, exclui leads
--   member – cria e edita leads
--   viewer – somente leitura

create table if not exists public.crm_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 60),
  public_form_enabled boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.crm_members (
  organization_id uuid not null references public.crm_organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index if not exists crm_members_user_idx on public.crm_members (user_id);

-- Leads passam a pertencer a uma organização. Falha de propósito se já existirem
-- leads sem organização: atribua-os manualmente antes de aplicar.
alter table public.crm_leads
  add column if not exists organization_id uuid references public.crm_organizations (id) on delete cascade;
alter table public.crm_leads alter column organization_id set not null;
alter table public.crm_leads
  add column if not exists created_by uuid references auth.users (id) on delete set null default auth.uid();
create index if not exists crm_leads_org_idx on public.crm_leads (organization_id, stage);

create table if not exists public.crm_stage_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.crm_organizations (id) on delete cascade,
  lead_id uuid not null references public.crm_leads (id) on delete cascade,
  from_stage text,
  to_stage text not null,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists crm_stage_history_lead_idx on public.crm_stage_history (lead_id, changed_at);

-- ---------------------------------------------------------------------------
-- Funções auxiliares (security definer para não recursar no RLS de crm_members)
-- ---------------------------------------------------------------------------

create or replace function public.crm_has_role(p_org uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.crm_members m
    where m.organization_id = p_org
      and m.user_id = auth.uid()
      and m.role = any (p_roles)
  );
$$;

create or replace function public.crm_is_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.crm_has_role(p_org, array['owner', 'admin', 'member', 'viewer']);
$$;

revoke all on function public.crm_has_role(uuid, text[]) from public, anon;
revoke all on function public.crm_is_member(uuid) from public, anon;
grant execute on function public.crm_has_role(uuid, text[]) to authenticated;
grant execute on function public.crm_is_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.crm_organizations enable row level security;
alter table public.crm_members enable row level security;
alter table public.crm_leads enable row level security;
alter table public.crm_stage_history enable row level security;

revoke all on public.crm_organizations, public.crm_members, public.crm_leads, public.crm_stage_history from anon;
grant select, update on public.crm_organizations to authenticated;
grant select, insert, update, delete on public.crm_members to authenticated;
grant select, insert, update, delete on public.crm_leads to authenticated;
grant select on public.crm_stage_history to authenticated;

-- Organizações: membros veem; owner/admin editam. Criação só pela função crm_create_organization.
drop policy if exists crm_org_select on public.crm_organizations;
create policy crm_org_select on public.crm_organizations
  for select to authenticated using (public.crm_is_member(id));
drop policy if exists crm_org_update on public.crm_organizations;
create policy crm_org_update on public.crm_organizations
  for update to authenticated
  using (public.crm_has_role(id, array['owner', 'admin']))
  with check (public.crm_has_role(id, array['owner', 'admin']));

-- Membros: membros veem a equipe; owner gerencia todos; admin gerencia não-owners.
drop policy if exists crm_members_select on public.crm_members;
create policy crm_members_select on public.crm_members
  for select to authenticated using (public.crm_is_member(organization_id));
drop policy if exists crm_members_insert on public.crm_members;
create policy crm_members_insert on public.crm_members
  for insert to authenticated with check (
    public.crm_has_role(organization_id, array['owner'])
    or (public.crm_has_role(organization_id, array['admin']) and role in ('admin', 'member', 'viewer'))
  );
drop policy if exists crm_members_update on public.crm_members;
create policy crm_members_update on public.crm_members
  for update to authenticated
  using (
    public.crm_has_role(organization_id, array['owner'])
    or (public.crm_has_role(organization_id, array['admin']) and role <> 'owner')
  )
  with check (
    public.crm_has_role(organization_id, array['owner'])
    or (public.crm_has_role(organization_id, array['admin']) and role <> 'owner')
  );
drop policy if exists crm_members_delete on public.crm_members;
create policy crm_members_delete on public.crm_members
  for delete to authenticated using (
    public.crm_has_role(organization_id, array['owner'])
    or (public.crm_has_role(organization_id, array['admin']) and role <> 'owner')
    or user_id = auth.uid()
  );

-- Impede que a organização fique sem proprietário.
create or replace function public.crm_keep_one_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    -- Exclusão em cascata da organização inteira é permitida.
    if not exists (select 1 from public.crm_organizations o where o.id = old.organization_id) then
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

drop trigger if exists crm_members_keep_one_owner on public.crm_members;
create trigger crm_members_keep_one_owner
  before update or delete on public.crm_members
  for each row execute function public.crm_keep_one_owner();

-- Leads: membros leem; member+ cria/edita; admin+ exclui.
drop policy if exists crm_leads_select on public.crm_leads;
create policy crm_leads_select on public.crm_leads
  for select to authenticated using (public.crm_is_member(organization_id));
drop policy if exists crm_leads_insert on public.crm_leads;
create policy crm_leads_insert on public.crm_leads
  for insert to authenticated
  with check (public.crm_has_role(organization_id, array['owner', 'admin', 'member']));
drop policy if exists crm_leads_update on public.crm_leads;
create policy crm_leads_update on public.crm_leads
  for update to authenticated
  using (public.crm_has_role(organization_id, array['owner', 'admin', 'member']))
  with check (public.crm_has_role(organization_id, array['owner', 'admin', 'member']));
drop policy if exists crm_leads_delete on public.crm_leads;
create policy crm_leads_delete on public.crm_leads
  for delete to authenticated
  using (public.crm_has_role(organization_id, array['owner', 'admin']));

drop policy if exists crm_stage_history_select on public.crm_stage_history;
create policy crm_stage_history_select on public.crm_stage_history
  for select to authenticated using (public.crm_is_member(organization_id));

-- Um lead não pode mudar de organização.
create or replace function public.crm_lock_lead_org()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id <> old.organization_id then
    raise exception 'Não é permitido mover um lead entre organizações.';
  end if;
  return new;
end;
$$;

drop trigger if exists crm_leads_lock_org on public.crm_leads;
create trigger crm_leads_lock_org
  before update on public.crm_leads
  for each row execute function public.crm_lock_lead_org();

-- Trilha de mudança de etapa.
create or replace function public.crm_log_stage_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    insert into public.crm_stage_history (organization_id, lead_id, from_stage, to_stage, changed_by)
    values (new.organization_id, new.id, case when tg_op = 'UPDATE' then old.stage end, new.stage, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists crm_leads_log_stage on public.crm_leads;
create trigger crm_leads_log_stage
  after insert or update of stage on public.crm_leads
  for each row execute function public.crm_log_stage_change();

-- ---------------------------------------------------------------------------
-- Funções de negócio expostas ao usuário autenticado
-- ---------------------------------------------------------------------------

create or replace function public.crm_slugify(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(lower(translate(p_text,
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]+', '-', 'g'), '-');
$$;

create or replace function public.crm_create_organization(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_base text;
  v_slug text;
  v_try int := 0;
begin
  if v_user is null then
    raise exception 'Autenticação obrigatória.' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) < 2 or length(btrim(p_name)) > 120 then
    raise exception 'Nome da organização deve ter entre 2 e 120 caracteres.';
  end if;
  if (select count(*) from public.crm_organizations o where o.created_by = v_user) >= 10 then
    raise exception 'Limite de organizações por usuário atingido.';
  end if;

  v_base := left(coalesce(nullif(public.crm_slugify(p_name), ''), 'org'), 50);
  if length(v_base) < 3 then v_base := v_base || '-org'; end if;
  v_slug := v_base;
  while exists (select 1 from public.crm_organizations o where o.slug = v_slug) loop
    v_try := v_try + 1;
    v_slug := v_base || '-' || substr(md5(random()::text), 1, 5);
    if v_try > 20 then raise exception 'Não foi possível gerar um identificador único.'; end if;
  end loop;

  insert into public.crm_organizations (name, slug, created_by)
  values (btrim(p_name), v_slug, v_user)
  returning id into v_org;

  insert into public.crm_members (organization_id, user_id, role) values (v_org, v_user, 'owner');
  return v_org;
end;
$$;

-- Lista as organizações do usuário com o papel dele.
create or replace function public.crm_my_organizations()
returns table (id uuid, name text, slug text, role text, public_form_enabled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name, o.slug, m.role, o.public_form_enabled
  from public.crm_members m
  join public.crm_organizations o on o.id = m.organization_id
  where m.user_id = auth.uid()
  order by o.created_at;
$$;

-- Adiciona (ou altera o papel de) um usuário já cadastrado, pelo e-mail.
create or replace function public.crm_add_member_by_email(p_org uuid, p_email text, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid;
begin
  if p_role not in ('admin', 'member', 'viewer') then
    raise exception 'Papel inválido.';
  end if;
  if not public.crm_has_role(p_org, array['owner', 'admin']) then
    raise exception 'Sem permissão para gerenciar membros.' using errcode = '42501';
  end if;
  select u.id into v_target from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_target is null then
    raise exception 'Usuário não encontrado. Peça para a pessoa criar a conta primeiro.';
  end if;
  if exists (select 1 from public.crm_members m where m.organization_id = p_org and m.user_id = v_target and m.role = 'owner') then
    raise exception 'O papel de um proprietário não pode ser alterado por aqui.';
  end if;
  insert into public.crm_members (organization_id, user_id, role)
  values (p_org, v_target, p_role)
  on conflict (organization_id, user_id) do update set role = excluded.role;
end;
$$;

-- Equipe da organização com e-mail (auth.users não é exposto diretamente).
create or replace function public.crm_list_members(p_org uuid)
returns table (user_id uuid, email text, role text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, u.email::text, m.role, m.created_at
  from public.crm_members m
  join auth.users u on u.id = m.user_id
  where m.organization_id = p_org and public.crm_is_member(p_org)
  order by m.created_at;
$$;

revoke all on function public.crm_create_organization(text) from public, anon;
revoke all on function public.crm_my_organizations() from public, anon;
revoke all on function public.crm_add_member_by_email(uuid, text, text) from public, anon;
revoke all on function public.crm_list_members(uuid) from public, anon;
revoke all on function public.crm_keep_one_owner() from public, anon, authenticated;
revoke all on function public.crm_log_stage_change() from public, anon, authenticated;
grant execute on function public.crm_create_organization(text) to authenticated;
grant execute on function public.crm_my_organizations() to authenticated;
grant execute on function public.crm_add_member_by_email(uuid, text, text) to authenticated;
grant execute on function public.crm_list_members(uuid) to authenticated;
