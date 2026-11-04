"use client";

import { useState } from "react";
import { errorMessage, getSupabase } from "@/lib/supabase";

export function OrgSetup({ email, onCreated, onLogout }: { email: string; onCreated: (id: string) => void; onLogout: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const { data, error } = await getSupabase().rpc("crm_create_organization", { p_name: name });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    onCreated(data as string);
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand"><span className="wordmark">AXBI</span><strong>CRM</strong></div>
        <h1>Criar sua organização</h1>
        <p className="muted">Você entrou como {email}. Crie a organização da sua empresa ou peça para um administrador adicionar você à equipe dele.</p>
        {error && <div className="alert error" role="alert">{error}</div>}
        <label className="field">
          <span>Nome da empresa</span>
          <input required minLength={2} maxLength={120} value={name} onChange={e => setName(e.target.value)} />
        </label>
        <button className="button primary block" disabled={busy}>{busy ? "Criando..." : "Criar organização"}</button>
        <div className="auth-links"><button type="button" className="link" onClick={onLogout}>Sair</button></div>
      </form>
    </div>
  );
}
