// Formulário público: origens, CAPTCHA (Turnstile), honeypot, IP pseudonimizado e erros sem detalhes internos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clientIp, corsHeaders, handlePublicLead, ipHash, parseAllowedOrigins, verifyTurnstile } from "../lib/security.mjs";

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-publica",
  CRM_FORM_GATEWAY_SECRET: "s".repeat(40), TURNSTILE_SECRET_KEY: "turnstile-secreto",
  EMBED_ALLOWED_ORIGINS: "https://axbiinteligencia.com.br"
};
const CRM = "https://crm.axbi.example";
const headers = (h = {}) => new Headers({ "x-real-ip": "203.0.113.7", ...h });
const payload = (p = {}) => ({ slug: "axbi", name: "Visitante", phone: "62999990000", consent: true,
  consentVersion: "2026-11-05", website: "", turnstileToken: "tok", ...p });

/** fetch falso: responde ao Turnstile e ao Supabase e registra as chamadas. */
function fakeFetch({ turnstile = { success: true, action: "public-lead", hostname: "crm.axbi.example" }, rpc = { status: 200, body: true }, turnstileThrows = false } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("turnstile")) {
      if (turnstileThrows) throw new Error("rede");
      return new Response(JSON.stringify(turnstile));
    }
    return new Response(JSON.stringify(rpc.body), { status: rpc.status });
  };
  return { impl, calls };
}
const run = (opts = {}, f = fakeFetch()) => handlePublicLead({
  payload: opts.payload ?? payload(), headers: opts.headers ?? headers(), requestOrigin: CRM, env: opts.env ?? ENV, fetchImpl: f.impl
}).then(r => ({ ...r, calls: f.calls }));

test("origens: lista explícita, sem curinga nem http externo", () => {
  assert.deepEqual(parseAllowedOrigins("https://a.com https://www.a.com"), ["https://a.com", "https://www.a.com"]);
  assert.throws(() => parseAllowedOrigins("https://*.a.com"), /curinga/);
  assert.throws(() => parseAllowedOrigins("http://a.com"), /https/);
  assert.throws(() => parseAllowedOrigins("https://a.com/form"), /sem caminho/);
  assert.deepEqual(parseAllowedOrigins("http://localhost:3000"), ["http://localhost:3000"]);
});

test("CORS só para origens autorizadas", () => {
  assert.equal(corsHeaders("https://axbiinteligencia.com.br", ENV)["Access-Control-Allow-Origin"], "https://axbiinteligencia.com.br");
  assert.equal(corsHeaders("https://sub.axbiinteligencia.com.br", ENV)["Access-Control-Allow-Origin"], undefined);
  assert.equal(corsHeaders("https://evil.example", ENV)["Access-Control-Allow-Origin"], undefined);
});

test("IP: cabeçalho da Vercel e HMAC (nunca em texto aberto)", () => {
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" })), "198.51.100.1");
  assert.equal(clientIp(headers()), "203.0.113.7");
  const h = ipHash("203.0.113.7", "segredo");
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, ipHash("203.0.113.7", "outro-segredo"));
  assert.ok(!h.includes("203"));
});

test("envio normal: valida o CAPTCHA no servidor e chama o banco com chave de gateway e hash do IP", async () => {
  const r = await run();
  assert.equal(r.status, 200);
  assert.equal(r.calls.length, 2);
  const verify = new URLSearchParams(r.calls[0].init.body);
  assert.equal(verify.get("secret"), "turnstile-secreto");
  assert.equal(verify.get("remoteip"), "203.0.113.7");
  const sent = JSON.parse(r.calls[1].init.body);
  assert.equal(sent.p_gateway_key, ENV.CRM_FORM_GATEWAY_SECRET);
  assert.equal(sent.p_ip_hash, ipHash("203.0.113.7", ENV.CRM_FORM_GATEWAY_SECRET));
  assert.equal(sent.p_consent_version, "2026-11-05");
  assert.equal(sent.p_website, "");
  assert.ok(!("p_consent_text" in sent), "texto de consentimento não vem do navegador");
});

test("sem CAPTCHA, CAPTCHA inválido, expirado/reutilizado ou de outra ação: recusado sem tocar no banco", async () => {
  for (const [label, opts, f] of [
    ["sem token", { payload: payload({ turnstileToken: "" }) }, fakeFetch()],
    ["token inválido", {}, fakeFetch({ turnstile: { success: false, "error-codes": ["invalid-input-response"] } })],
    ["token expirado ou reutilizado", {}, fakeFetch({ turnstile: { success: false, "error-codes": ["timeout-or-duplicate"] } })],
    ["ação diferente", {}, fakeFetch({ turnstile: { success: true, action: "login" } })]
  ]) {
    const r = await run(opts, f);
    assert.equal(r.status, 400, label);
    assert.ok(!r.calls.some(c => c.url.includes("/rest/v1/")), `${label}: banco não chamado`);
  }
});

test("falha de rede no Turnstile nunca libera o envio", async () => {
  const r = await run({}, fakeFetch({ turnstileThrows: true }));
  assert.equal(r.status, 503);
  assert.ok(!r.calls.some(c => c.url.includes("/rest/v1/")));
});

test("hostname do CAPTCHA conferido quando configurado", async () => {
  const env = { ...ENV, TURNSTILE_ALLOWED_HOSTNAMES: "crm.axbi.example" };
  assert.equal((await run({ env }, fakeFetch({ turnstile: { success: true, action: "public-lead", hostname: "evil.example" } }))).status, 400);
  assert.equal((await run({ env })).status, 200);
});

test("honeypot preenchido: sucesso aparente, sem CAPTCHA nem banco", async () => {
  const r = await run({ payload: payload({ website: "http://spam" }) });
  assert.equal(r.status, 200);
  assert.equal(r.calls.length, 0);
});

test("origem não autorizada recusada; mesma origem e site autorizado aceitos", async () => {
  assert.equal((await run({ headers: headers({ origin: "https://evil.example" }) })).status, 403);
  assert.equal((await run({ headers: headers({ origin: "https://sub.axbiinteligencia.com.br" }) })).status, 403);
  assert.equal((await run({ headers: headers({ origin: CRM }) })).status, 200);
  assert.equal((await run({ headers: headers({ origin: "https://axbiinteligencia.com.br" }) })).status, 200);
});

test("sem segredos configurados: formulário indisponível (não simula proteção)", async () => {
  for (const k of ["TURNSTILE_SECRET_KEY", "CRM_FORM_GATEWAY_SECRET", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) {
    const r = await run({ env: { ...ENV, [k]: "" } });
    assert.equal(r.status, 503, k);
    assert.equal(r.calls.length, 0, k);
  }
  assert.equal((await run({ env: { ...ENV, CRM_FORM_GATEWAY_SECRET: "curto" } })).status, 503);
});

test("erros do banco: só mensagens de validação chegam ao visitante", async () => {
  const limite = await run({}, fakeFetch({ rpc: { status: 400, body: { code: "P0001", message: "Muitos envios no momento. Tente novamente mais tarde." } } }));
  assert.equal(limite.status, 400);
  assert.equal(limite.body.error, "Muitos envios no momento. Tente novamente mais tarde.");
  const interno = await run({}, fakeFetch({ rpc: { status: 500, body: { code: "XX000", message: "relation crm_private.settings detalhe interno" } } }));
  assert.equal(interno.status, 502);
  assert.ok(!interno.body.error.includes("crm_private"));
  const gateway = await run({}, fakeFetch({ rpc: { status: 401, body: { code: "42501", message: "Formulário indisponível." } } }));
  assert.equal(gateway.status, 503);
});

test("segredos nunca em variáveis públicas nem no código do navegador", () => {
  const env = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  for (const line of env.split("\n").filter(l => l.startsWith("NEXT_PUBLIC_"))) {
    assert.ok(!/SECRET|SERVICE|GATEWAY/i.test(line.split("=")[0]), `segredo exposto: ${line}`);
  }
  const page = readFileSync(new URL("../app/f/[slug]/page.tsx", import.meta.url), "utf8");
  assert.ok(!/TURNSTILE_SECRET|CRM_FORM_GATEWAY|crm_submit_public_lead/.test(page), "página não fala direto com o banco nem conhece segredos");
});
