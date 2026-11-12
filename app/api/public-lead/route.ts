import { corsHeaders, handlePublicLead } from "@/lib/security.mjs";

// Envio do formulário público: valida o CAPTCHA (Turnstile) no servidor e só então chama o banco.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 16 * 1024;
const json = (status: number, body: unknown, extra: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin"), process.env) });
}

export async function POST(req: Request) {
  const cors = corsHeaders(req.headers.get("origin"), process.env);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { ok: false, error: "Envio muito grande." }, cors);
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return json(400, { ok: false, error: "Envio inválido." }, cors); }
  const { status, body } = await handlePublicLead({
    payload, headers: req.headers, requestOrigin: new URL(req.url).origin, env: process.env
  });
  return json(status, body, cors);
}
