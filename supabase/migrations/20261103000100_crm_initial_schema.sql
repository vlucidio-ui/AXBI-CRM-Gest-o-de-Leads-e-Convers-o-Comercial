-- AXBI CRM: schema base de leads.
-- O isolamento por organização e o RLS são aplicados na migration 20261103000200.

create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  company text not null default '' check (length(company) <= 200),
  email text not null default '' check (length(email) <= 320),
  phone text not null default '' check (length(phone) <= 40),
  segment text not null default '' check (length(segment) <= 120),
  source text not null default '' check (length(source) <= 120),
  campaign text not null default '' check (length(campaign) <= 200),
  pain text not null default '' check (length(pain) <= 2000),
  urgency text not null default 'Sem prazo'
    check (urgency in ('Imediata', 'Até 30 dias', 'Até 90 dias', 'Sem prazo')),
  decision_maker boolean not null default false,
  estimated_value numeric(14, 2) not null default 0 check (estimated_value >= 0),
  stage text not null default 'Novo lead'
    check (stage in ('Novo lead', 'Em qualificação', 'Qualificado', 'Diagnóstico agendado',
                     'Diagnóstico realizado', 'Proposta enviada', 'Negociação', 'Fechado',
                     'Perdido', 'Nutrição')),
  next_action text not null default '' check (length(next_action) <= 500),
  next_action_date date,
  notes text not null default '' check (length(notes) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.crm_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists crm_leads_touch_updated_at on public.crm_leads;
create trigger crm_leads_touch_updated_at
  before update on public.crm_leads
  for each row execute function public.crm_touch_updated_at();

create index if not exists crm_leads_stage_idx on public.crm_leads (stage);
create index if not exists crm_leads_next_action_date_idx on public.crm_leads (next_action_date);

-- Bloqueado por padrão até a migration de segurança criar as políticas.
alter table public.crm_leads enable row level security;
revoke all on public.crm_leads from anon;
