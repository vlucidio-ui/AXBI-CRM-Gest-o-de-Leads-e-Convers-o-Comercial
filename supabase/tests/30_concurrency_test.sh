#!/usr/bin/env bash
# Concorrência real: vários processos psql em paralelo, cada um em sua transação (como requisições
# simultâneas no PostgREST). Roda depois de 10_rls_test.sql e 20_security_test.sql.
set -euo pipefail
DB="$1"
PSQL=(psql "$DB" -X -q -t -A -v ON_ERROR_STOP=1)
KEY="chave-de-teste-gateway-0123456789abcdef"
"${PSQL[@]}" <<'SQL'
insert into auth.users values ('00000000-0000-0000-0000-0000000000e1', 'eva@c.com'), ('00000000-0000-0000-0000-0000000000f1', 'fabio@c.com');
insert into public.crm_organizations (id, name, slug, public_form_enabled)
  values ('00000000-0000-0000-0000-0000000000c1', 'Corrida', 'corrida', true);
insert into public.crm_members values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 'owner', now()),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1', 'owner', now());
SQL

enviar() { # $1 = e-mail, $2 = hash do IP
  "${PSQL[@]}" >/dev/null 2>&1 <<SQL || true
begin;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select public.crm_submit_public_lead('corrida', 'Corrida', '$1', '', '', '', true, '2026-11-05', '', '', '', '$KEY', '$2');
select pg_sleep(0.5);
commit;
SQL
}
falha() { echo "FALHA: $1"; exit 1; }

# 1. Mesmo contato, 10 envios simultâneos (limite 3/dia por contato).
for i in $(seq 1 10); do enviar "mesmo@x.com" "$(printf '%064x' "$i")" & done; wait
n=$("${PSQL[@]}" -c "select count(*) from public.crm_leads where email = 'mesmo@x.com'")
[ "$n" = 3 ] || falha "limite por contato sob concorrência: $n leads (esperado 3)"
echo "ok: 10 envios simultâneos do mesmo contato -> $n leads (limite 3)"

# 2. Mesmo IP, 15 contatos simultâneos (limite 10/hora por IP).
for i in $(seq 1 15); do enviar "ip$i@x.com" "$(printf 'ee%.0s' {1..32})" & done; wait
n=$("${PSQL[@]}" -c "select count(*) from public.crm_leads where email like 'ip%@x.com' and organization_id = '00000000-0000-0000-0000-0000000000c1'")
[ "$n" = 10 ] || falha "limite por IP sob concorrência: $n leads (esperado 10)"
echo "ok: 15 envios simultâneos do mesmo IP -> $n leads (limite 10)"

# 3. Organização: 70 envios simultâneos de contatos e IPs diferentes (limite 60/hora; 13 já usados acima).
for i in $(seq 1 70); do enviar "org$i@x.com" "$(printf '%064x' "$((1000 + i))")" & done; wait
n=$("${PSQL[@]}" -c "select count(*) from public.crm_form_submissions where organization_id = '00000000-0000-0000-0000-0000000000c1'")
[ "$n" = 60 ] || falha "limite por organização sob concorrência: $n envios (esperado 60)"
echo "ok: 70 envios simultâneos na organização -> $n no total (limite 60/hora)"

# 4. Dois proprietários rebaixam um ao outro ao mesmo tempo: a organização não pode ficar sem dono.
rebaixar() { # $1 = quem executa, $2 = quem é rebaixado
  "${PSQL[@]}" >/dev/null 2>&1 <<SQL || true
begin;
select set_config('request.jwt.claim.sub', '$1', true);
set local role authenticated;
update public.crm_members set role = 'admin' where organization_id = '00000000-0000-0000-0000-0000000000c1' and user_id = '$2';
select pg_sleep(0.5);
commit;
SQL
}
rebaixar 00000000-0000-0000-0000-0000000000e1 00000000-0000-0000-0000-0000000000f1 &
rebaixar 00000000-0000-0000-0000-0000000000f1 00000000-0000-0000-0000-0000000000e1 &
wait
n=$("${PSQL[@]}" -c "select count(*) from public.crm_members where organization_id = '00000000-0000-0000-0000-0000000000c1' and role = 'owner'")
[ "$n" -ge 1 ] || falha "organização ficou sem proprietário"
echo "ok: rebaixamentos simultâneos -> $n proprietário(s) restante(s)"
echo "TESTES DE CONCORRÊNCIA PASSARAM"
