-- AXBI CRM: agenda as duas rotinas de limpeza (antes só existiam as funções).
-- Reversão: supabase/rollback/20261112000900_crm_maintenance_schedule.down.sql
--   crm-send-control   -> crm_purge_form_submissions(): apaga o controle de envios do formulário
--                         com mais de 7 dias (contém hash de contato e de IP);
--   crm-invite-control -> crm_purge_member_lookups(): apaga o registro de consultas de convite.
-- Usa pg_cron. Onde a extensão não existe (Postgres de teste), a migration só avisa e segue.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron indisponível: rotinas de limpeza NÃO agendadas neste banco.';
    return;
  end if;
  execute 'create extension if not exists pg_cron';
  execute $q$select cron.unschedule(jobid) from cron.job where jobname in ('crm-send-control', 'crm-invite-control')$q$;
  execute $q$select cron.schedule('crm-send-control', '17 3 * * *', 'select public.crm_purge_form_submissions()')$q$;
  execute $q$select cron.schedule('crm-invite-control', '27 3 * * *', 'select public.crm_purge_member_lookups()')$q$;
end $$;
