import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Quando as variáveis não estão definidas, o CRM roda em modo local (navegador). */
export const supabaseEnabled = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabaseEnabled) throw new Error("Supabase não configurado.");
  if (!client) {
    client = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  return client;
}

/** Converte erros do Supabase/Postgres em mensagens legíveis. */
export function errorMessage(error: unknown): string {
  if (!error) return "Erro desconhecido.";
  const e = error as { message?: string; code?: string };
  const msg = e.message ?? String(error);
  if (e.code === "42501" || /row-level security/i.test(msg)) return "Você não tem permissão para esta ação.";
  if (/Invalid login credentials/i.test(msg)) return "E-mail ou senha incorretos.";
  if (/Email not confirmed/i.test(msg)) return "Confirme seu e-mail antes de entrar (veja sua caixa de entrada).";
  if (/User already registered/i.test(msg)) return "Já existe uma conta com este e-mail.";
  if (/Password should be at least/i.test(msg)) return "A senha precisa ter pelo menos 8 caracteres.";
  if (/Failed to fetch|NetworkError/i.test(msg)) return "Sem conexão com o servidor. Tente novamente.";
  return msg;
}
