#!/usr/bin/env bash
# Aplica as migrations num banco Postgres descartável e roda os testes de RLS e de segurança.
# Uso: DATABASE_URL=postgres://... npm run test:db   (o banco será apagado e recriado)
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?Defina DATABASE_URL apontando para um Postgres DESCARTÁVEL (nunca o do Supabase).}"
PSQL=(psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1)
recriar() {
  "${PSQL[@]}" -c 'drop schema if exists crm_private cascade; drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;'
  "${PSQL[@]}" -f supabase/tests/00_supabase_stub.sql
}
aplicar() { for f in supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done; }

# 1. Reversão: aplica tudo, desfaz as migrations de endurecimento (ordem inversa) e reaplica.
recriar; aplicar
for f in $(ls supabase/rollback/*.down.sql | sort -r); do "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -f supabase/migrations/20261104000400_crm_public_form_phone.sql
for f in supabase/migrations/2026110500*.sql; do "${PSQL[@]}" -f "$f"; done
echo "ok: migrations de endurecimento revertidas e reaplicadas"

# 2. Banco limpo para os testes de comportamento.
recriar
for f in supabase/migrations/*.sql; do echo "Aplicando $f"; "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -o /dev/null -f supabase/tests/10_rls_test.sql
"${PSQL[@]}" -o /dev/null -f supabase/tests/20_security_test.sql
bash supabase/tests/30_concurrency_test.sh "$DATABASE_URL"
