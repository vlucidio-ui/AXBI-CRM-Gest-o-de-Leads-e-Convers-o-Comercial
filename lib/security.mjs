// Segurança do formulário público (funções puras, testadas em tests/security.test.mjs).
import { createHmac } from "node:crypto";

export const DEFAULT_EMBED_ORIGINS = "https://axbiinteligencia.com.br https://www.axbiinteligencia.com.br";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_ACTION = "public-lead";

/**
 * Lista explícita de origens autorizadas a incorporar o formulário e a enviar para /api/public-lead.
 * Aceita só origens exatas https (http apenas em localhost/127.0.0.1); recusa curingas como https://*.dominio.
 */
export function parseAllowedOrigins(value = DEFAULT_EMBED_ORIGINS) {
  const origins = String(value ?? "").split(/[\s,]+/).filter(Boolean);
  return origins.map(o => {
    if (o.includes("*")) throw new Error(`EMBED_ALLOWED_ORIGINS não aceita curinga: ${o}`);
    let u;
    try { u = new URL(o); } catch { throw new Error(`origem inválida em EMBED_ALLOWED_ORIGINS: ${o}`); }
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(local && u.protocol === "http:")) throw new Error(`origem deve usar https: ${o}`);
    if (u.origin !== o.replace(/\/$/, "")) throw new Error(`informe só a origem (sem caminho): ${o}`);
    return u.origin;
  });
}

/** IP do visitante atrás da Vercel (que sobrescreve estes cabeçalhos; o visitante não os controla). */
export function clientIp(headers) {
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : "desconhecido";
}

/** Pseudonimiza o IP (HMAC-SHA256 com segredo do servidor): o banco nunca recebe o IP em texto. */
export function ipHash(ip, secret) {
  return createHmac("sha256", secret).update(`ip:${ip}`).digest("hex");
}

/**
 * Valida o token do Cloudflare Turnstile no servidor. Tokens inválidos, expirados ou reutilizados
 * são recusados pela própria Cloudflare (error-codes invalid-input-response / timeout-or-duplicate).
 * Falha de rede ou resposta inesperada também recusa (nunca libera por padrão).
 */
export async function verifyTurnstile({ token, ip, secret, allowedHostnames = [], fetchImpl = fetch, timeoutMs = 5000 }) {
  if (!secret) return { ok: false, reason: "not-configured" };
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return { ok: false, reason: "missing-token" };
  const body = new URLSearchParams({ secret, response: token });
  if (ip && ip !== "desconhecido") body.set("remoteip", ip);
  let data;
  try {
    const res = await fetchImpl(SITEVERIFY, { method: "POST", body, signal: AbortSignal.timeout(timeoutMs) });
    data = await res.json();
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!data || data.success !== true) {
    const codes = Array.isArray(data?.["error-codes"]) ? data["error-codes"] : [];
    return { ok: false, reason: codes.includes("timeout-or-duplicate") ? "expired-or-reused" : "invalid", codes };
  }
  if (data.action !== TURNSTILE_ACTION) return { ok: false, reason: "wrong-action" };
  if (allowedHostnames.length && !allowedHostnames.includes(data.hostname)) return { ok: false, reason: "wrong-hostname" };
  return { ok: true };
}

const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Processa um envio do formulário público. Ordem: origem → configuração → honeypot → CAPTCHA → banco.
 * Retorna { status, body } sem detalhes internos.
 */
export async function handlePublicLead({ payload, headers, requestOrigin, env, fetchImpl = fetch }) {
  const origin = headers.get("origin");
  const allowed = parseAllowedOrigins(env.EMBED_ALLOWED_ORIGINS ?? DEFAULT_EMBED_ORIGINS);
  if (origin && origin !== requestOrigin && !allowed.includes(origin)) {
    return { status: 403, body: { ok: false, error: "Origem não autorizada." } };
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL, anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const gateway = env.CRM_FORM_GATEWAY_SECRET, turnstileSecret = env.TURNSTILE_SECRET_KEY;
  if (!url || !anonKey || !gateway || gateway.length < 32 || !turnstileSecret) {
    return { status: 503, body: { ok: false, error: "Formulário temporariamente indisponível." } };
  }
  if (!payload || typeof payload !== "object") return { status: 400, body: { ok: false, error: "Envio inválido." } };

  // Campo-armadilha: robôs preenchem; respondemos sucesso e descartamos sem consultar nada.
  if (text(payload.website, 200).trim() !== "") return { status: 200, body: { ok: true } };

  const ip = clientIp(headers);
  const hostnames = String(env.TURNSTILE_ALLOWED_HOSTNAMES ?? "").split(/[\s,]+/).filter(Boolean);
  const captcha = await verifyTurnstile({ token: payload.turnstileToken, ip, secret: turnstileSecret, allowedHostnames: hostnames, fetchImpl });
  if (!captcha.ok) {
    const error = captcha.reason === "unavailable" ? "Não foi possível validar a verificação. Tente novamente."
      : "Confirme a verificação de segurança e envie novamente.";
    return { status: captcha.reason === "unavailable" ? 503 : 400, body: { ok: false, error } };
  }

  let res, data;
  try {
    res = await fetchImpl(`${url}/rest/v1/rpc/crm_submit_public_lead`, {
      method: "POST",
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_slug: text(payload.slug, 60), p_name: text(payload.name, 200), p_email: text(payload.email, 320),
        p_phone: text(payload.phone, 40), p_company: text(payload.company, 200), p_pain: text(payload.pain, 2000),
        p_consent: payload.consent === true, p_consent_version: text(payload.consentVersion, 40),
        p_website: "", p_campaign: text(payload.campaign, 200), p_notes: text(payload.notes, 1000),
        p_gateway_key: gateway, p_ip_hash: ipHash(ip, gateway)
      }),
      signal: AbortSignal.timeout(8000)
    });
    data = await res.json().catch(() => null);
  } catch {
    return { status: 503, body: { ok: false, error: "Não foi possível enviar agora. Tente novamente." } };
  }
  if (res.ok) return { status: 200, body: { ok: true } };
  // Só mensagens de validação do próprio formulário (raise exception, código P0001) chegam ao visitante.
  if (data?.code === "P0001" && typeof data.message === "string") return { status: 400, body: { ok: false, error: data.message } };
  if (data?.code === "42501") return { status: 503, body: { ok: false, error: "Formulário temporariamente indisponível." } };
  console.error("crm_submit_public_lead falhou", res.status, data?.code ?? "");
  return { status: 502, body: { ok: false, error: "Não foi possível enviar agora. Tente novamente." } };
}

/** Cabeçalhos CORS: só para origens da lista explícita. */
export function corsHeaders(origin, env) {
  const allowed = parseAllowedOrigins(env.EMBED_ALLOWED_ORIGINS ?? DEFAULT_EMBED_ORIGINS);
  const h = { Vary: "Origin" };
  if (origin && allowed.includes(origin)) {
    Object.assign(h, { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" });
  }
  return h;
}
