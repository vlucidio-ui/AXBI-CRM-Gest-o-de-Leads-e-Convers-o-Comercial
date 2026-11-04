"use client";

import { useState } from "react";
import { errorMessage, getSupabase } from "@/lib/supabase";

type Mode = "login" | "signup" | "forgot";

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setMessage(""); setBusy(true);
    const supabase = getSupabase();
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signup") {
        if (password.length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
        const { data, error } = await supabase.auth.signUp({
          email, password, options: { emailRedirectTo: window.location.origin }
        });
        if (error) throw error;
        // O Supabase não revela se o e-mail já existe: devolve um usuário sem identidades.
        if (data.user && data.user.identities?.length === 0) {
          setMode("login");
          throw new Error("Este e-mail já tem conta. Entre com sua senha ou use \"Esqueci a senha\".");
        }
        if (!data.session) setMessage("Conta criada. Enviamos um link de confirmação para o seu e-mail.");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/redefinir-senha`
        });
        if (error) throw error;
        setMessage("Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.");
      }
    } catch (err) {
      const msg = errorMessage(err);
      setError(mode === "login" && msg === "E-mail ou senha incorretos."
        ? "E-mail ou senha incorretos. Se não lembra a senha, clique em \"Esqueci a senha\"."
        : msg);
    } finally {
      setBusy(false);
    }
  }

  const titles: Record<Mode, string> = { login: "Entrar", signup: "Criar conta", forgot: "Recuperar senha" };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand"><span className="logo">AX</span><strong>AXBI CRM</strong></div>
        <h1>{titles[mode]}</h1>
        {error && <div className="alert error" role="alert">{error}</div>}
        {message && <div className="alert success" role="status">{message}</div>}
        <label className="field">
          <span>E-mail</span>
          <input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        {mode !== "forgot" && (
          <label className="field">
            <span>Senha</span>
            <input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required
              minLength={mode === "signup" ? 8 : undefined} value={password} onChange={e => setPassword(e.target.value)} />
          </label>
        )}
        <button className="button primary block" disabled={busy}>{busy ? "Aguarde..." : titles[mode]}</button>
        <div className="auth-links">
          {mode !== "login" && <button type="button" className="link" onClick={() => setMode("login")}>Já tenho conta</button>}
          {mode !== "signup" && <button type="button" className="link" onClick={() => setMode("signup")}>Criar conta</button>}
          {mode !== "forgot" && <button type="button" className="link" onClick={() => setMode("forgot")}>Esqueci a senha</button>}
        </div>
      </form>
    </div>
  );
}
