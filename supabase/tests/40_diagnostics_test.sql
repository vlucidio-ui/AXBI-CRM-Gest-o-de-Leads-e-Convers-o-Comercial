-- Diagnósticos: isolamento por organização, autoria, imutabilidade do resultado e fluxo de aprovação.
-- Roda depois de 10_rls_test.sql e 20_security_test.sql, no mesmo banco.
\set ON_ERROR_STOP on
create or replace function pg_temp.login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false);
  if p is null then execute 'set role anon'; else execute 'set role authenticated'; end if;
end $$;
create or replace function pg_temp.expect_error(p_sql text, p_label text, p_pattern text default null) returns void language plpgsql as $$
declare v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    v_msg := sqlerrm;
    if p_pattern is not null and v_msg !~ p_pattern then
      raise exception 'FALHA: % (erro inesperado: %)', p_label, v_msg;
    end if;
    raise notice 'ok (bloqueado): %', p_label;
    return;
  end;
  raise exception 'FALHA: deveria ter sido bloqueado: %', p_label;
end $$;
create or replace function pg_temp.expect(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FALHA: %', p_label; end if;
  raise notice 'ok: %', p_label;
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;
create temp table ids as
  select (select id from public.crm_organizations where slug = 'acao-vendas') as org_a,
         (select o.id from public.crm_organizations o join public.crm_members m on m.organization_id = o.id
           where m.user_id = '00000000-0000-0000-0000-00000000000b' and o.slug <> 'acao-vendas' limit 1) as org_b;
grant select on ids to anon, authenticated;
select pg_temp.expect((select org_a is not null and org_b is not null from ids), 'organizações A e B de teste existem');

-- Privilégios da tabela nova.
select pg_temp.expect((select string_agg(privilege_type, ',' order by privilege_type) from information_schema.table_privileges
  where table_schema = 'public' and table_name = 'crm_diagnostics' and grantee = 'authenticated') = 'DELETE,INSERT,SELECT,UPDATE',
  'authenticated sem TRUNCATE/TRIGGER/REFERENCES em diagnósticos');
select pg_temp.expect(not exists (select 1 from information_schema.table_privileges
  where table_name = 'crm_diagnostics' and grantee = 'anon'), 'anon sem acesso a diagnósticos');

-- Vendedor (c) cria; autoria e status são definidos pelo banco.
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
insert into public.crm_diagnostics (organization_id, title, engine_version, result, created_by, reviewed_by, reviewed_at)
  select org_a, 'Diagnóstico 2024', 'teste/1', '{"anos":[2024]}'::jsonb,
         '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', now() from ids;
select pg_temp.expect((select created_by = '00000000-0000-0000-0000-00000000000c' and reviewed_by is null and reviewed_at is null
  and status = 'rascunho' from public.crm_diagnostics where title = 'Diagnóstico 2024'), 'autoria pelo banco; revisão falsificada ignorada');
select pg_temp.expect_error($q$insert into public.crm_diagnostics (organization_id, title, engine_version, result, status)
  select org_a, 'Já aprovado', 'teste/1', '{}'::jsonb, 'aprovado' from ids$q$, 'criar diagnóstico já aprovado', 'rascunho');
select pg_temp.expect_error($q$insert into public.crm_diagnostics (organization_id, title, engine_version, result)
  select org_b, 'Invasor', 'teste/1', '{}'::jsonb from ids$q$, 'criar diagnóstico em outra organização');
select pg_temp.expect_error($q$insert into public.crm_diagnostics (organization_id, title, engine_version, result)
  select org_a, 'Lista', 'teste/1', '[]'::jsonb from ids$q$, 'resultado que não é objeto');
select pg_temp.expect_error($q$insert into public.crm_diagnostics (organization_id, title, engine_version, result, cnpj)
  select org_a, 'CNPJ', 'teste/1', '{}'::jsonb, '12.345' from ids$q$, 'CNPJ fora do formato');

-- Lead de outra organização não pode ser vinculado.
set role postgres;
insert into public.crm_leads (id, organization_id, name) select '00000000-0000-0000-0000-0000000000f1', org_b, 'Lead da B' from ids;
insert into public.crm_leads (id, organization_id, name) select '00000000-0000-0000-0000-0000000000f2', org_a, 'Lead da A' from ids;
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error($q$update public.crm_diagnostics set lead_id = '00000000-0000-0000-0000-0000000000f1' where title = 'Diagnóstico 2024'$q$,
  'vincular lead de outra organização', 'não pertence');
update public.crm_diagnostics set lead_id = '00000000-0000-0000-0000-0000000000f2' where title = 'Diagnóstico 2024';
select pg_temp.expect((select lead_id is not null from public.crm_diagnostics where title = 'Diagnóstico 2024'), 'vincular lead da própria organização');

-- Resultado calculado e autoria são imutáveis.
select pg_temp.expect_error($q$update public.crm_diagnostics set result = '{"anos":[1999]}'::jsonb where title = 'Diagnóstico 2024'$q$,
  'alterar o resultado calculado', 'não podem ser alterados');
select pg_temp.expect_error($q$update public.crm_diagnostics set created_by = '00000000-0000-0000-0000-00000000000d' where title = 'Diagnóstico 2024'$q$,
  'alterar a autoria', 'não podem ser alterados');
select pg_temp.expect_error($q$update public.crm_diagnostics set organization_id = (select org_b from ids) where title = 'Diagnóstico 2024'$q$,
  'mover diagnóstico para outra organização');

-- Fluxo de aprovação.
select pg_temp.expect_error($q$update public.crm_diagnostics set status = 'aprovado' where title = 'Diagnóstico 2024'$q$,
  'aprovar sem passar pela revisão', 'revisão antes');
update public.crm_diagnostics set status = 'em_revisao' where title = 'Diagnóstico 2024';
select pg_temp.expect_error($q$update public.crm_diagnostics set status = 'aprovado' where title = 'Diagnóstico 2024'$q$,
  'vendedor aprovar', 'proprietário ou administrador');
delete from public.crm_diagnostics where title = 'Diagnóstico 2024';
select pg_temp.expect((select count(*) = 1 from public.crm_diagnostics where title = 'Diagnóstico 2024'), 'vendedor não exclui diagnóstico');

-- Leitor (d) vê, mas não cria nem altera.
select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect((select count(*) = 1 from public.crm_diagnostics), 'leitor vê os diagnósticos da organização');
select pg_temp.expect_error($q$insert into public.crm_diagnostics (organization_id, title, engine_version, result)
  select org_a, 'Leitor', 'teste/1', '{}'::jsonb from ids$q$, 'leitor criar diagnóstico');
update public.crm_diagnostics set title = 'Alterado pelo leitor';
select pg_temp.expect((select count(*) = 0 from public.crm_diagnostics where title = 'Alterado pelo leitor'), 'leitor não altera diagnóstico');
select pg_temp.expect_error('truncate public.crm_diagnostics', 'leitor TRUNCATE em diagnósticos');

-- Outra organização (b) e visitante não enxergam nada.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) = 0 from public.crm_diagnostics), 'outra organização não vê diagnósticos da A');
update public.crm_diagnostics set title = 'Invadido';
delete from public.crm_diagnostics;
select pg_temp.login(null);
select pg_temp.expect_error('select count(*) from public.crm_diagnostics', 'visitante ler diagnósticos');

-- Proprietário (a) aprova; depois disso nada muda.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select count(*) = 1 from public.crm_diagnostics where title = 'Diagnóstico 2024'), 'diagnóstico intacto após tentativas de outra organização');
update public.crm_diagnostics set status = 'aprovado', review_notes = 'Conferido.', reviewed_by = '00000000-0000-0000-0000-00000000000d'
  where title = 'Diagnóstico 2024';
select pg_temp.expect((select status = 'aprovado' and reviewed_by = '00000000-0000-0000-0000-00000000000a' and reviewed_at is not null
  from public.crm_diagnostics where title = 'Diagnóstico 2024'), 'aprovação registra quem aprovou (valor falsificado ignorado)');
select pg_temp.expect_error($q$update public.crm_diagnostics set title = 'Outro título' where title = 'Diagnóstico 2024'$q$,
  'alterar diagnóstico aprovado', 'aprovado não pode');
select pg_temp.expect_error($q$update public.crm_diagnostics set status = 'rascunho' where title = 'Diagnóstico 2024'$q$,
  'reabrir diagnóstico aprovado', 'aprovado não pode');
delete from public.crm_diagnostics where title = 'Diagnóstico 2024';
select pg_temp.expect((select count(*) = 0 from public.crm_diagnostics), 'proprietário pode excluir');

set role postgres;
\echo TESTES DE DIAGNÓSTICOS PASSARAM
