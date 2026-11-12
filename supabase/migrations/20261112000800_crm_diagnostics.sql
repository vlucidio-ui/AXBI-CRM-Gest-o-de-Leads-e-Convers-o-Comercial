-- AXBI CRM: diagnósticos contábeis gerados pelo motor determinístico (AXBI-DIAG-CORE).
-- Reversão: supabase/rollback/20261112000800_crm_diagnostics.down.sql
--
-- O navegador lê as escriturações (ECF/ECD), calcula o diagnóstico e grava aqui SOMENTE o resultado
-- (demonstrativos, indicadores, achados e o SHA-256 de cada arquivo). Os arquivos originais não são
-- armazenados. Regras garantidas pelo banco:
--   * isolamento por organização (RLS), como nos leads;
--   * o resultado calculado é imutável: recalcular gera um novo registro (histórico de versões);
--   * fluxo rascunho -> em_revisao -> aprovado; só proprietário/administrador aprova;
--   * diagnóstico aprovado não pode mais ser alterado; quem aprovou e quando ficam registrados.

create table if not exists public.crm_diagnostics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.crm_organizations (id) on delete cascade,
  lead_id uuid references public.crm_leads (id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 200),
  company_name text not null default '' check (length(company_name) <= 200),
  cnpj text not null default '' check (cnpj = '' or cnpj ~ '^[0-9]{14}$'),
  years integer[] not null default '{}' check (cardinality(years) <= 20),
  engine_version text not null check (length(engine_version) between 1 and 40),
  status text not null default 'rascunho' check (status in ('rascunho', 'em_revisao', 'aprovado')),
  result jsonb not null check (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 5000000),
  review_notes text not null default '' check (length(review_notes) <= 5000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz
);

create index if not exists crm_diagnostics_org_idx on public.crm_diagnostics (organization_id, created_at desc);
create index if not exists crm_diagnostics_lead_idx on public.crm_diagnostics (lead_id);

alter table public.crm_diagnostics enable row level security;
revoke all on public.crm_diagnostics from anon, authenticated;
grant select, insert, update, delete on public.crm_diagnostics to authenticated;

drop policy if exists crm_diagnostics_select on public.crm_diagnostics;
create policy crm_diagnostics_select on public.crm_diagnostics
  for select to authenticated using (public.crm_is_member(organization_id));
drop policy if exists crm_diagnostics_insert on public.crm_diagnostics;
create policy crm_diagnostics_insert on public.crm_diagnostics
  for insert to authenticated with check (public.crm_has_role(organization_id, array['owner', 'admin', 'member']));
drop policy if exists crm_diagnostics_update on public.crm_diagnostics;
create policy crm_diagnostics_update on public.crm_diagnostics
  for update to authenticated
  using (public.crm_has_role(organization_id, array['owner', 'admin', 'member']))
  with check (public.crm_has_role(organization_id, array['owner', 'admin', 'member']));
drop policy if exists crm_diagnostics_delete on public.crm_diagnostics;
create policy crm_diagnostics_delete on public.crm_diagnostics
  for delete to authenticated using (public.crm_has_role(organization_id, array['owner', 'admin']));

-- Integridade: autoria, resultado e fluxo de aprovação. Vale para quem chama pela API; o
-- administrador do banco (outro current_user) não passa por esta regra.
create or replace function public.crm_protect_diagnostic()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if new.lead_id is not null and not exists (
    select 1 from public.crm_leads l where l.id = new.lead_id and l.organization_id = new.organization_id
  ) then
    raise exception 'O lead informado não pertence a esta organização.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    new.reviewed_by := null;
    new.reviewed_at := null;
    if new.status <> 'rascunho' then
      raise exception 'Um diagnóstico novo começa como rascunho.' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.status = 'aprovado' then
    raise exception 'Diagnóstico aprovado não pode ser alterado. Gere uma nova versão.' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
     or new.result is distinct from old.result or new.engine_version is distinct from old.engine_version
     or new.cnpj is distinct from old.cnpj or new.years is distinct from old.years then
    raise exception 'Autoria e resultado calculado do diagnóstico não podem ser alterados.' using errcode = '42501';
  end if;
  new.reviewed_by := null;
  new.reviewed_at := null;
  if new.status = 'aprovado' then
    if old.status <> 'em_revisao' then
      raise exception 'Envie o diagnóstico para revisão antes de aprovar.' using errcode = '42501';
    end if;
    if not public.crm_has_role(new.organization_id, array['owner', 'admin']) then
      raise exception 'Só proprietário ou administrador aprova diagnósticos.' using errcode = '42501';
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.crm_protect_diagnostic() from public, anon, authenticated;

drop trigger if exists crm_diagnostics_protect on public.crm_diagnostics;
create trigger crm_diagnostics_protect
  before insert or update on public.crm_diagnostics
  for each row execute function public.crm_protect_diagnostic();

drop trigger if exists crm_diagnostics_touch_updated_at on public.crm_diagnostics;
create trigger crm_diagnostics_touch_updated_at
  before update on public.crm_diagnostics
  for each row execute function public.crm_touch_updated_at();
