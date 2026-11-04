"use client";

import { useState } from "react";
import { errorMessage, getSupabase } from "@/lib/supabase";
import type { Organization } from "@/lib/types";

export function SettingsPanel({ organization, onChanged }: { organization: Organization; onChanged: () => void }) {
  const canManage = organization.role === "owner" || organization.role === "admin";
  const [name, setName] = useState(organization.name);
  const [enabled, setEnabled] = useState(organization.publicFormEnabled);
  const [privacyUrl, setPrivacyUrl] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const formUrl = typeof window !== "undefined" ? `${window.location.origin}/f/${organization.slug}` : "";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setMessage("");
    const patch: Record<string, unknown> = { name, public_form_enabled: enabled };
    if (privacyUrl) patch.privacy_policy_url = privacyUrl;
    const { error } = await getSupabase().from("crm_organizations").update(patch).eq("id", organization.id);
    if (error) return setError(errorMessage(error));
    setMessage("Configurações salvas.");
    onChanged();
  }

  return (
    <section className="panel">
      <h3>Configurações da organização</h3>
      {error && <div className="alert error" role="alert">{error}</div>}
      {message && <div className="alert success" role="status">{message}</div>}
      <form className="settings" onSubmit={save}>
        <label className="field"><span>Nome</span>
          <input value={name} onChange={e => setName(e.target.value)} disabled={!canManage} minLength={2} maxLength={120} required />
        </label>
        <label className="field checkbox">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} disabled={!canManage} />
          <span>Ativar formulário público de captação de leads</span>
        </label>
        <label className="field"><span>Link da política de privacidade (https://...)</span>
          <input type="url" pattern="https://.*" placeholder="https://suaempresa.com.br/privacidade" value={privacyUrl}
            onChange={e => setPrivacyUrl(e.target.value)} disabled={!canManage} />
        </label>
        {canManage && <button className="button primary">Salvar</button>}
      </form>
      {organization.publicFormEnabled && (
        <p>Link do formulário: <a href={formUrl} target="_blank" rel="noreferrer">{formUrl}</a><br />
          <span className="muted small">Use em anúncios, bio do Instagram ou site. Adicione <code>?campanha=nome</code> para registrar a campanha.</span></p>
      )}
    </section>
  );
}
