-- Testes de isolamento, papéis e formulário público. Falha com exceção no primeiro erro.
\set ON_ERROR_STOP on
insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a', 'ana@a.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bruno@b.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@a.com'),
  ('00000000-0000-0000-0000-00000000000d', 'davi@a.com');

create or replace function pg_temp.login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false);
  if p is null then execute 'set role anon'; else execute 'set role authenticated'; end if;
end $$;
create or replace function pg_temp.expect_error(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
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

-- Ana cria a organização A; Bruno cria a B.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
create temp table ids as select public.crm_create_organization('Ação Vendas') as org_a;
grant select on ids to anon, authenticated;
select pg_temp.expect((select slug from public.crm_organizations) = 'acao-vendas', 'slug gerado sem acento');
insert into public.crm_leads (organization_id, name, stage) select org_a, 'Lead A1', 'Novo lead' from ids;
select pg_temp.expect((select count(*) from public.crm_stage_history) = 1, 'histórico registra criação');
update public.crm_leads set stage = 'Qualificado' where name = 'Lead A1';
select pg_temp.expect((select count(*) from public.crm_stage_history where to_stage = 'Qualificado' and from_stage = 'Novo lead') = 1, 'histórico registra mudança de etapa');
select public.crm_add_member_by_email((select org_a from ids), 'carla@a.com', 'member');
select public.crm_add_member_by_email((select org_a from ids), 'davi@a.com', 'viewer');
select pg_temp.expect((select count(*) from public.crm_list_members((select org_a from ids))) = 3, 'equipe com 3 membros');

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
create temp table ids_b as select public.crm_create_organization('Org B') as org_b;
insert into public.crm_leads (organization_id, name) select org_b, 'Lead B1' from ids_b;

-- Isolamento
select pg_temp.expect((select count(*) from public.crm_leads) = 1, 'Bruno vê só os leads da B');
select pg_temp.expect((select count(*) from public.crm_organizations) = 1, 'Bruno vê só a própria organização');
select pg_temp.expect((select count(*) from public.crm_stage_history) = 1, 'Bruno vê só o histórico da B');
select pg_temp.expect_error($q$insert into public.crm_leads (organization_id, name) select org_a, 'invasor' from ids$q$, 'Bruno inserir lead na A');
update public.crm_leads set name = 'hack' where name = 'Lead A1';
delete from public.crm_leads where name = 'Lead A1';
select pg_temp.expect_error($q$insert into public.crm_members (organization_id, user_id, role) select org_a, '00000000-0000-0000-0000-00000000000b', 'owner' from ids$q$, 'Bruno se adicionar na A');
select pg_temp.expect_error($q$select public.crm_add_member_by_email((select org_a from ids), 'bruno@b.com', 'admin')$q$, 'Bruno usar função de convite na A');
select pg_temp.expect((select count(*) from public.crm_list_members((select org_a from ids))) = 0, 'Bruno não lista equipe da A');
select pg_temp.expect_error($q$update public.crm_leads set organization_id = (select org_a from ids)$q$, 'mover lead para outra organização');

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select name from public.crm_leads) = 'Lead A1', 'lead da A intacto após tentativas da B');

-- Papéis dentro da A
select pg_temp.login('00000000-0000-0000-0000-00000000000c'); -- member
insert into public.crm_leads (organization_id, name) select org_a, 'Lead A2' from ids;
update public.crm_leads set stage = 'Negociação' where name = 'Lead A2';
delete from public.crm_leads where name = 'Lead A2';
select pg_temp.expect((select count(*) from public.crm_leads where name = 'Lead A2') = 1, 'vendedor não exclui lead');
select pg_temp.expect_error($q$insert into public.crm_members (organization_id, user_id, role) select org_a, '00000000-0000-0000-0000-00000000000b', 'member' from ids$q$, 'vendedor adicionar membro');

select pg_temp.login('00000000-0000-0000-0000-00000000000d'); -- viewer
select pg_temp.expect((select count(*) from public.crm_leads) = 2, 'leitor vê leads');
select pg_temp.expect_error($q$insert into public.crm_leads (organization_id, name) select org_a, 'x' from ids$q$, 'leitor criar lead');
update public.crm_leads set name = 'x';
select pg_temp.expect((select count(*) from public.crm_leads where name = 'x') = 0, 'leitor não edita lead');

select pg_temp.login('00000000-0000-0000-0000-00000000000a'); -- owner
delete from public.crm_leads where name = 'Lead A2';
select pg_temp.expect((select count(*) from public.crm_leads where name = 'Lead A2') = 0, 'proprietário exclui lead');
select pg_temp.expect_error($q$delete from public.crm_members where user_id = '00000000-0000-0000-0000-00000000000a'$q$, 'remover o único proprietário');

-- Formulário público
select pg_temp.login(null);
select pg_temp.expect_error($q$select * from public.crm_leads$q$, 'anônimo ler leads');
select pg_temp.expect_error($q$select * from public.crm_organizations$q$, 'anônimo ler organizações');
select pg_temp.expect_error($q$select public.crm_create_organization('anon org')$q$, 'anônimo criar organização');
select pg_temp.expect((select count(*) from public.crm_public_form_info('acao-vendas')) = 0, 'formulário desativado não aparece');
select pg_temp.expect_error($q$select public.crm_submit_public_lead('acao-vendas','Zé','ze@x.com','','','',true,'Aceito o tratamento dos meus dados.')$q$, 'envio com formulário desativado');

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
update public.crm_organizations set public_form_enabled = true;

select pg_temp.login(null);
select pg_temp.expect((select name from public.crm_public_form_info('acao-vendas')) = 'Ação Vendas', 'formulário ativo aparece');
select pg_temp.expect_error($q$select public.crm_submit_public_lead('acao-vendas','Zé','ze@x.com','','','',false,'Aceito o tratamento dos meus dados.')$q$, 'envio sem consentimento');
select pg_temp.expect_error($q$select public.crm_submit_public_lead('acao-vendas','Zé','email-invalido','','','',true,'Aceito o tratamento dos meus dados.')$q$, 'envio com e-mail inválido');
select public.crm_submit_public_lead('acao-vendas','Robô','bot@x.com','','','',true,'Aceito o tratamento dos meus dados.','http://spam');
select public.crm_submit_public_lead('acao-vendas','Zé Silva','ze@x.com','11999990000','Padaria','Quero vender mais',true,'Aceito o tratamento dos meus dados.');
select public.crm_submit_public_lead('acao-vendas','Zé Silva','ze@x.com','','','',true,'Aceito o tratamento dos meus dados.');
select public.crm_submit_public_lead('acao-vendas','Zé Silva','ZE@x.com','','','',true,'Aceito o tratamento dos meus dados.');
select pg_temp.expect_error($q$select public.crm_submit_public_lead('acao-vendas','Zé Silva','ze@x.com','','','',true,'Aceito o tratamento dos meus dados.')$q$, 'quarto envio do mesmo e-mail no dia');
select pg_temp.expect_error($q$select * from public.crm_form_submissions$q$, 'anônimo ler controle de envios');
-- Site da AXBI: só WhatsApp (sem e-mail), com regime nas observações
select public.crm_submit_public_lead('acao-vendas','João Site','','(62) 99999-0000','Loja','Margem',true,'Aceito o tratamento dos meus dados.','','site','Regime tributário: Lucro Presumido');
select pg_temp.expect_error($q$select public.crm_submit_public_lead('acao-vendas','Sem Contato','','','','',true,'Aceito o tratamento dos meus dados.')$q$, 'envio sem WhatsApp nem e-mail');
select pg_temp.expect_error($q$select public.crm_submit_public_lead('acao-vendas','Tel Curto','','1234','','',true,'Aceito o tratamento dos meus dados.')$q$, 'envio com WhatsApp inválido');

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select count(*) from public.crm_leads where origin = 'public_form') = 4, 'leads do formulário chegaram (robô descartado)');
select pg_temp.expect((select count(*) from public.crm_leads where origin = 'public_form' and consent_at is not null) = 4, 'consentimento registrado');
select pg_temp.expect((select notes from public.crm_leads where name = 'João Site') = 'Regime tributário: Lucro Presumido' and (select campaign from public.crm_leads where name = 'João Site') = 'site', 'lead só com WhatsApp, regime e campanha');

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) from public.crm_leads where origin = 'public_form') = 0, 'leads do formulário da A invisíveis para a B');

reset role;
\echo 'TODOS OS TESTES DE BANCO PASSARAM'
