#!/usr/bin/env bash
# Aplica as migrations num banco Postgres descartável e roda os testes de RLS.
# Uso: DATABASE_URL=postgres://... npm run test:db   (o banco será apagado e recriado)
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?Defina DATABASE_URL apontando para um Postgres DESCARTÁVEL (nunca o do Supabase).}"
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -c 'drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;'
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do
  echo "Aplicando $f"
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$f"
done
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -o /dev/null -f supabase/tests/10_rls_test.sql
