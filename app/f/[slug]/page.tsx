"use client";

import { useEffect, useState } from "react";
import { errorMessage, getSupabase, supabaseEnabled } from "@/lib/supabase";

type Info = { name: string; privacy_policy_url: string | null };

export default function PublicForm({ params }: { params: { slug: string } }) {
  const [info, setInfo] = useState<Info | null | undefined>(undefined);
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", pain: "", website: "" });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

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

  if (info === undefined) return <div className="center-screen muted">Carregando...</div>;
  if (info === null) return <div className="center-screen"><div className="auth-card"><h1>Formulário indisponível</h1><p className="muted">Este link não está ativo.</p></div></div>;

  const consentText = `Autorizo ${info.name} a usar meus dados (nome, e-mail, telefone e mensagem) para entrar em contato sobre seus serviços, conforme a LGPD. Posso pedir a exclusão a qualquer momento.`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!consent) return setError("Marque a autorização para enviar.");
    setBusy(true);
    const query = new URLSearchParams(window.location.search);
    const campaign = query.get("campanha") ?? query.get("utm_campaign") ?? "";
    const { error } = await getSupabase().rpc("crm_submit_public_lead", {
      p_slug: params.slug, p_name: form.name, p_email: form.email, p_phone: form.phone,
      p_company: form.company, p_pain: form.pain, p_consent: consent, p_consent_text: consentText,
      p_website: form.website, p_campaign: campaign.slice(0, 200)
    });
    setBusy(false);
    if (error) return setError(errorMessage(error));
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
            <button className="button primary block" disabled={busy}>{busy ? "Enviando..." : "Enviar"}</button>
          </>
        )}
      </form>
    </div>
  );
}
