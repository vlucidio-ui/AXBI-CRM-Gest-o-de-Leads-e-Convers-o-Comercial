-- Reversão de 20261112000900: remove os agendamentos (as funções de limpeza continuam existindo).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$select cron.unschedule(jobid) from cron.job where jobname in ('crm-send-control', 'crm-invite-control')$q$;
  end if;
end $$;
