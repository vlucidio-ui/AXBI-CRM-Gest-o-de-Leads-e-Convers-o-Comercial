// Verificações estáticas das migrations e do código do navegador.
// Os testes de comportamento (RLS) ficam em supabase/tests e rodam com `npm run test:db`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = new URL("../supabase/migrations/", import.meta.url).pathname;
const files = readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
const sql = files.map(f => readFileSync(join(dir, f), "utf8")).join("\n");

test("migrations existem e seguem a ordem por data", () => {
  assert.ok(files.length >= 3);
  for (const f of files) assert.match(f, /^\d{14}_[a-z0-9_]+\.sql$/);
});

test("toda tabela criada tem RLS habilitado", () => {
  const tables = [...sql.matchAll(/create table if not exists (public\.\w+)/g)].map(m => m[1]);
  assert.ok(tables.length >= 5);
  for (const t of tables) {
    assert.ok(sql.includes(`alter table ${t} enable row level security`), `RLS ausente em ${t}`);
  }
});

test("toda função security definer fixa search_path", () => {
  const fns = sql.split(/create or replace function /).slice(1);
  for (const body of fns) {
    const header = body.slice(0, body.indexOf("$$"));
    if (/security definer/.test(header)) {
      assert.match(header, /set search_path = ''/, `search_path ausente em ${header.split("(")[0]}`);
    }
  }
});

test("anon só executa as funções do formulário público", () => {
  const grantsToAnon = [...sql.matchAll(/grant ([^;]+) to ([^;]*\banon\b[^;]*);/g)].map(m => m[1]);
  assert.ok(grantsToAnon.length > 0);
  for (const g of grantsToAnon) {
    assert.match(g, /^execute on function public\.crm_(public_form_info|submit_public_lead)\(/, `grant indevido para anon: ${g}`);
  }
});

test("o código do navegador nunca referencia service_role", () => {
  const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  const root = new URL("..", import.meta.url).pathname;
  const sources = ["app", "components", "lib"].flatMap(d => walk(join(root, d)));
  for (const f of sources) {
    assert.ok(!/service_role|SERVICE_ROLE/.test(readFileSync(f, "utf8")), `service_role encontrado em ${f}`);
  }
});
