"use client";

import { useEffect, useState } from "react";
import { errorMessage, getSupabase, supabaseEnabled } from "@/lib/supabase";

export default function ResetPassword() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!supabaseEnabled) return;
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.");
    if (password !== confirm) return setError("As senhas não coincidem.");
    const { error } = await getSupabase().auth.updateUser({ password });
    if (error) return setError(errorMessage(error));
    setDone(true);
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand"><span className="logo">AX</span><strong>AXBI CRM</strong></div>
        <h1>Nova senha</h1>
        {!supabaseEnabled && <div className="alert error">Supabase não configurado.</div>}
        {error && <div className="alert error" role="alert">{error}</div>}
        {done ? (
          <div className="alert success">Senha alterada. <a href="/">Ir para o CRM</a></div>
        ) : !ready ? (
          <p className="muted">Validando o link de recuperação... Se nada acontecer, solicite um novo link.</p>
        ) : (
          <>
            <label className="field"><span>Nova senha</span>
              <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} />
            </label>
            <label className="field"><span>Confirmar senha</span>
              <input type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={e => setConfirm(e.target.value)} />
            </label>
            <button className="button primary block">Salvar nova senha</button>
          </>
        )}
      </form>
    </div>
  );
}
