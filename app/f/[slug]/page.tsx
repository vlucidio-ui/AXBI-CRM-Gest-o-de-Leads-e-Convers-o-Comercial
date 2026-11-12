"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { getSupabase, supabaseEnabled } from "@/lib/supabase";

type Info = { name: string; privacy_policy_url: string | null; consent_text: string; consent_version: string };
type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
};
declare global { interface Window { turnstile?: Turnstile } }

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export default function PublicForm() {
  const params = useParams<{ slug: string }>();
  const [info, setInfo] = useState<Info | null | undefined>(undefined);
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", pain: "", website: "" });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const widget = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);

  // Dentro de um iframe (ex.: site da empresa): visual enxuto e altura informada ao site.
  useEffect(() => {
    if (window.self === window.top) return;
    document.documentElement.classList.add("embedded");
    const post = () => window.parent.postMessage(
      { type: "axbi-crm-form-height", height: Math.ceil(document.body.getBoundingClientRect().height) }, "*");
    const observer = new ResizeObserver(post);
    observer.observe(document.body);
    post();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!supabaseEnabled) { setInfo(null); return; }
    getSupabase().rpc("crm_public_form_info", { p_slug: params.slug }).then(({ data }) => {
      setInfo(Array.isArray(data) && data.length ? (data[0] as Info) : null);
    });
  }, [params.slug]);

  // Verificação anti-robô (Cloudflare Turnstile). O token é validado no servidor e vale para um único envio.
  useEffect(() => {
    if (!info || !SITE_KEY || !widget.current) return;
    const el = widget.current;
    const render = () => {
      if (!window.turnstile || widgetId.current !== undefined) return;
      widgetId.current = window.turnstile.render(el, {
        sitekey: SITE_KEY, action: "public-lead", language: "pt-BR",
        callback: (t: string) => setToken(t),
        "expired-callback": () => setToken(""),
        "error-callback": () => setToken("")
      });
    };
    if (window.turnstile) return render();
    let script = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SRC}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = TURNSTILE_SRC; script.async = true; script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", render);
    return () => script?.removeEventListener("load", render);
  }, [info]);

  if (info === undefined) return <div className="center-screen muted">Carregando...</div>;
  if (info === null) return <div className="center-screen"><div className="auth-card"><h1>Formulário indisponível</h1><p className="muted">Este link não está ativo.</p></div></div>;

  // Texto oficial vem do banco (versão vigente do termo); o navegador não define o que foi consentido.
  const consentText = info.consent_text;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!consent) return setError("Marque a autorização para enviar.");
    if (!token) return setError("Conclua a verificação de segurança.");
    setBusy(true);
    const query = new URLSearchParams(window.location.search);
    const campaign = query.get("campanha") ?? query.get("utm_campaign") ?? "";
    let result: { ok: boolean; error?: string } = { ok: false, error: "Sem conexão com o servidor. Tente novamente." };
    try {
      const res = await fetch("/api/public-lead", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: params.slug, name: form.name, email: form.email, phone: form.phone, company: form.company,
          pain: form.pain, consent, consentVersion: info?.consent_version, website: form.website,
          campaign: campaign.slice(0, 200), turnstileToken: token
        })
      });
      result = await res.json();
    } catch { /* mantém a mensagem de conexão */ }
    setBusy(false);
    // O token do CAPTCHA vale uma vez: renova para uma nova tentativa.
    setToken(""); window.turnstile?.reset(widgetId.current);
    if (!result.ok) return setError(result.error ?? "Não foi possível enviar agora.");
    setSent(true);
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="auth-page">
      <form className="auth-card wide-card" onSubmit={submit}>
        <h1>Fale com {info.name}</h1>
        {sent ? (
          <div className="alert success" role="status">Recebemos seus dados. Em breve entraremos em contato.</div>
        ) : (
          <>
            <p className="muted">Preencha e retornaremos o contato.</p>
            {error && <div className="alert error" role="alert">{error}</div>}
            <label className="field"><span>Nome *</span><input required minLength={2} maxLength={200} autoComplete="name" value={form.name} onChange={set("name")} /></label>
            <label className="field"><span>E-mail *</span><input type="email" required maxLength={320} autoComplete="email" value={form.email} onChange={set("email")} /></label>
            <label className="field"><span>Telefone / WhatsApp</span><input type="tel" maxLength={40} autoComplete="tel" value={form.phone} onChange={set("phone")} /></label>
            <label className="field"><span>Empresa</span><input maxLength={200} autoComplete="organization" value={form.company} onChange={set("company")} /></label>
            <label className="field"><span>Como podemos ajudar?</span><textarea rows={3} maxLength={2000} value={form.pain} onChange={set("pain")} /></label>
            {/* Campo-armadilha antispam: invisível para pessoas. */}
            <div className="hp" aria-hidden="true">
              <label>Site<input tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} /></label>
            </div>
            <label className="field checkbox consent">
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} required />
              <span>{consentText}{info.privacy_policy_url && <> <a href={info.privacy_policy_url} target="_blank" rel="noreferrer">Política de privacidade</a>.</>}</span>
            </label>
            {SITE_KEY ? <div ref={widget} className="captcha" /> : <div className="alert error" role="alert">Verificação de segurança não configurada.</div>}
            <button className="button primary block" disabled={busy || !SITE_KEY}>{busy ? "Enviando..." : "Enviar"}</button>
          </>
        )}
      </form>
    </div>
  );
}
