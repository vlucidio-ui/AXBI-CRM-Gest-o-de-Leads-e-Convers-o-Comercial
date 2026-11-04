-- Testes de regressão das correções de segurança (roda depois de 10_rls_test.sql, no mesmo banco).
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
-- Envio com controle de todos os parâmetros de segurança.
create or replace function pg_temp.enviar2(p_email text, p_ip text default null, p_key text default 'chave-de-teste-gateway-0123456789abcdef',
  p_version text default '2026-11-05', p_website text default '', p_slug text default 'acao-vendas') returns boolean language sql as $f$
  select public.crm_submit_public_lead(p_slug, 'Visitante', p_email, '', '', '', true, p_version, p_website, 'teste', '',
    p_key, coalesce(p_ip, encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex')))
$f$;
grant execute on all functions in schema pg_temp to anon, authenticated;
create temp table org_a as select id from public.crm_organizations where slug = 'acao-vendas';
grant select on org_a to anon, authenticated;

-- ===== V6: privilégios residuais =====
select pg_temp.expect(not exists (
  select 1 from information_schema.table_privileges
  where table_schema in ('public', 'crm_private') and grantee in ('anon', 'authenticated')
    and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')), 'anon/authenticated sem TRUNCATE, TRIGGER e REFERENCES');
select pg_temp.expect(not exists (
  select 1 from information_schema.table_privileges where table_schema in ('public', 'crm_private') and grantee = 'anon'),
  'anon sem privilégio em tabelas');
select pg_temp.expect((select string_agg(privilege_type, ',' order by privilege_type) from information_schema.table_privileges
  where table_schema = 'public' and table_name = 'crm_stage_history' and grantee = 'authenticated') = 'SELECT',
  'histórico de etapas é somente leitura para authenticated');
select pg_temp.expect(not has_schema_privilege('authenticated', 'crm_private', 'usage') and not has_schema_privilege('anon', 'crm_private', 'usage'),
  'esquema crm_private inacessível pela API');
select pg_temp.expect((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
  where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute'))
  = array['crm_public_form_info', 'crm_submit_public_lead'], 'anon executa só as duas funções do formulário');
select pg_temp.expect(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
  and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false)), 'toda security definer com search_path fixo');

select pg_temp.login('00000000-0000-0000-0000-00000000000d'); -- leitor
select pg_temp.expect_error('truncate public.crm_leads', 'leitor TRUNCATE em leads');
select pg_temp.expect_error('truncate public.crm_stage_history', 'leitor TRUNCATE no histórico');
select pg_temp.login('00000000-0000-0000-0000-00000000000a'); -- proprietário
select pg_temp.expect_error('truncate public.crm_organizations cascade', 'proprietário TRUNCATE em organizações');
select pg_temp.expect_error('select * from crm_private.settings', 'usuário lê a chave do gateway');

-- ===== V1: autoria dos leads =====
select pg_temp.login('00000000-0000-0000-0000-00000000000c'); -- vendedor
insert into public.crm_leads (organization_id, name, created_by, created_at)
  select id, 'Autoria', '00000000-0000-0000-0000-00000000000a', now() - interval '1 year' from org_a;
select pg_temp.expect((select created_by from public.crm_leads where name = 'Autoria') = '00000000-0000-0000-0000-00000000000c',
  'autor do lead é sempre quem criou (valor falsificado ignorado)');
select pg_temp.expect((select created_at > now() - interval '1 minute' from public.crm_leads where name = 'Autoria'),
  'data de criação definida pelo banco');
insert into public.crm_leads (organization_id, name) select id, 'Autoria padrão' from org_a;
select pg_temp.expect((select created_by from public.crm_leads where name = 'Autoria padrão') = '00000000-0000-0000-0000-00000000000c',
  'autor preenchido quando omitido');
select pg_temp.expect_error($q$update public.crm_leads set created_by = '00000000-0000-0000-0000-00000000000d' where name = 'Autoria'$q$,
  'vendedor trocar o autor', 'Autoria');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($q$update public.crm_leads set created_by = null where name = 'Autoria'$q$, 'proprietário apagar o autor', 'Autoria');
update public.crm_leads set stage = 'Qualificado', notes = 'ok' where name = 'Autoria';
select pg_temp.expect((select stage from public.crm_leads where name = 'Autoria') = 'Qualificado', 'edição normal do lead continua permitida');
-- upsert como o app faz (sem created_by): continua funcionando
insert into public.crm_leads (id, organization_id, name, stage)
  select l.id, l.organization_id, 'Autoria', 'Negociação' from public.crm_leads l where l.name = 'Autoria'
  on conflict (id) do update set stage = excluded.stage;
select pg_temp.expect((select stage || '|' || created_by from public.crm_leads where name = 'Autoria') = 'Negociação|00000000-0000-0000-0000-00000000000c',
  'upsert do app preserva o autor');

-- ===== V2: origem e consentimento não podem ser forjados pela API =====
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error($q$insert into public.crm_leads (organization_id, name, origin) select id, 'Falso', 'public_form' from org_a$q$,
  'vendedor criar lead como se viesse do formulário', 'formulário');
select pg_temp.expect_error($q$insert into public.crm_leads (organization_id, name, consent_at, consent_text) select id, 'Falso', now(), 'inventado' from org_a$q$,
  'vendedor inventar consentimento', 'formulário');
select pg_temp.expect_error($q$update public.crm_leads set consent_text = 'alterado' where origin = 'public_form'$q$, 'vendedor alterar texto do consentimento', 'consentimento');
select pg_temp.expect_error($q$update public.crm_leads set consent_at = now() where origin = 'public_form'$q$, 'vendedor alterar data do consentimento', 'consentimento');
select pg_temp.expect_error($q$update public.crm_leads set origin = 'manual' where origin = 'public_form'$q$, 'vendedor alterar origem', 'consentimento');
update public.crm_organizations set created_by = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect((select created_by from public.crm_organizations where slug = 'acao-vendas') = '00000000-0000-0000-0000-00000000000a', 'vendedor não troca criador da organização (RLS)');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($q$update public.crm_organizations set created_by = null where slug = 'acao-vendas'$q$, 'proprietário trocar criador da organização', 'Criador');
update public.crm_organizations set privacy_policy_url = 'https://axbi.example/privacidade', privacy_policy_version = 'v3' where slug = 'acao-vendas';

-- ===== V3/V5: formulário público =====
select pg_temp.login(null);
select pg_temp.expect((select consent_version from public.crm_public_form_info('acao-vendas')) = '2026-11-05', 'página recebe a versão vigente do termo');
select pg_temp.expect((select consent_text from public.crm_public_form_info('acao-vendas')) like 'Autorizo Ação Vendas a usar meus dados%', 'texto oficial vem do banco, com o nome da organização');
select pg_temp.expect_error($q$select pg_temp.enviar2('sem-chave@x.com', p_key => null)$q$, 'envio sem passar pelo servidor (sem chave)', 'indisponível');
select pg_temp.expect_error($q$select pg_temp.enviar2('chave-errada@x.com', p_key => 'chave-errada-0123456789abcdef0123456789')$q$, 'envio com chave de gateway errada', 'indisponível');
select pg_temp.expect_error($q$select pg_temp.enviar2('sem-ip@x.com', p_ip => 'nao-e-hash')$q$, 'envio sem hash de IP válido', 'indisponível');
select pg_temp.expect_error($q$select pg_temp.enviar2('versao@x.com', p_version => '2020-01-01')$q$, 'envio com versão antiga do termo', 'atualizado');
select pg_temp.expect_error($q$select pg_temp.enviar2('naoexiste@x.com', p_slug => 'nao-existe')$q$, 'envio para formulário inexistente', 'indisponível');
select pg_temp.expect(pg_temp.enviar2('bot@x.com', p_website => 'http://spam'), 'honeypot: resposta de sucesso para o robô');
select pg_temp.expect(pg_temp.enviar2('lgpd@x.com'), 'envio normal aceito');
select pg_temp.expect_error('select * from public.crm_consent_records', 'anônimo ler registros de consentimento');

reset role;
select pg_temp.expect((select count(*) from public.crm_leads where email = 'bot@x.com') = 0, 'honeypot: lead do robô descartado');
select pg_temp.expect((select consent_version = '2026-11-05' and consent_purpose like 'Contato comercial%' and consent_text like 'Autorizo Ação Vendas%'
  from public.crm_leads where email = 'lgpd@x.com'), 'lead grava texto, versão e finalidade oficiais');
select pg_temp.expect((select r.term_version = '2026-11-05' and r.privacy_policy_url = 'https://axbi.example/privacidade' and r.privacy_policy_version = 'v3'
  and r.text_sha256 = encode(sha256(convert_to(l.consent_text, 'UTF8')), 'hex')
  from public.crm_consent_records r join public.crm_leads l on l.id = r.lead_id where l.email = 'lgpd@x.com'),
  'registro de consentimento com versão do termo e da política, e hash do texto');

-- Limite por IP: 10 por hora por organização
select pg_temp.login(null);
select pg_temp.enviar2('ip' || g || '@x.com', p_ip => repeat('ab', 32)) from generate_series(1, 10) g;
select pg_temp.expect_error($q$select pg_temp.enviar2('ip11@x.com', p_ip => repeat('ab', 32))$q$, 'décimo primeiro envio do mesmo IP na hora', 'Muitos envios');
select pg_temp.expect(pg_temp.enviar2('outro-ip@x.com', p_ip => repeat('cd', 32)), 'outro IP continua enviando');

-- Formulário desativado
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
update public.crm_organizations set public_form_enabled = false where slug = 'acao-vendas';
select pg_temp.login(null);
select pg_temp.expect_error($q$select pg_temp.enviar2('desativado@x.com')$q$, 'envio com formulário desativado', 'indisponível');
select pg_temp.expect((select count(*) from public.crm_public_form_info('acao-vendas')) = 0, 'formulário desativado não aparece');

-- LGPD: exclusão do lead (pedido do titular) mantém a prova de consentimento sem dados pessoais
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
delete from public.crm_leads where email = 'lgpd@x.com';
reset role;
select pg_temp.expect((select count(*) from public.crm_leads where email = 'lgpd@x.com') = 0, 'lead excluído a pedido do titular');
select pg_temp.expect(exists (select 1 from public.crm_consent_records where lead_id is null and term_version = '2026-11-05'),
  'registro de consentimento preservado, desvinculado do lead');
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error($q$update public.crm_consent_records set purpose = 'x'$q$, 'membro alterar registro de consentimento');
select pg_temp.expect_error($q$delete from public.crm_consent_records$q$, 'membro apagar registro de consentimento');
select pg_temp.expect_error($q$insert into public.crm_consent_terms (version, purpose, text_template, active) values ('x', 'finalidade longa', 'Autorizo {organizacao} qualquer coisa aqui', false)$q$,
  'membro criar termo de consentimento');
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) from public.crm_consent_records) = 0, 'outra organização não vê registros de consentimento da A');

-- ===== V8: limite de consultas no convite por e-mail =====
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
create temp table org_b as select id from public.crm_organizations where slug = 'org-b';
select pg_temp.expect((select public.crm_add_member_by_email((select id from org_b), 'ninguem@x.com', 'member')) = 'not_found', 'convite para e-mail sem conta informa não encontrado');
select public.crm_add_member_by_email((select id from org_b), 'sonda' || g || '@x.com', 'member') from generate_series(1, 18) g;
select pg_temp.expect((select public.crm_add_member_by_email((select id from org_b), 'carla@a.com', 'viewer')) = 'added', 'convite válido dentro do limite');
select pg_temp.expect_error($q$select public.crm_add_member_by_email((select id from org_b), 'davi@a.com', 'viewer')$q$, 'vigésima primeira consulta na hora', 'Muitas tentativas');
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error($q$select public.crm_add_member_by_email((select id from org_a), 'bruno@b.com', 'admin')$q$, 'vendedor usar convite', 'permissão');

reset role;
\echo 'TESTES DE SEGURANÇA PASSARAM'
