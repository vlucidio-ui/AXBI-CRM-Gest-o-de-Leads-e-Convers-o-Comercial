"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { LogOut } from "lucide-react";
import { supabaseRepository } from "@/lib/repository";
import { errorMessage, getSupabase } from "@/lib/supabase";
import { roleLabels, type Organization, type Role } from "@/lib/types";
import { AuthScreen } from "./AuthScreen";
import { CrmApp } from "./CrmApp";
import { OrgSetup } from "./OrgSetup";
import { SettingsPanel } from "./SettingsPanel";
import { TeamPanel } from "./TeamPanel";

const ACTIVE_ORG_KEY = "axbi-crm-active-org";

async function fetchOrgs(): Promise<{ list: Organization[]; error: string }> {
  const { data, error } = await getSupabase().rpc("crm_my_organizations");
  if (error) return { list: [], error: errorMessage(error) };
  const list: Organization[] = (data ?? []).map((o: { id: string; name: string; slug: string; role: Role; public_form_enabled: boolean }) => ({
    id: o.id, name: o.name, slug: o.slug, role: o.role, publicFormEnabled: o.public_form_enabled
  }));
  return { list, error: "" };
}

export function CloudCrm() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // Organizações do usuário logado; ficam associadas ao id dele para não vazar entre contas.
  const [orgState, setOrgState] = useState<{ userId: string; list: Organization[] } | null>(null);
  const [activeId, setActiveId] = useState<string>("");
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      // Link de "Esqueci a senha" pode cair na página inicial: leva para a tela de nova senha.
      if (event === "PASSWORD_RECOVERY") {
        window.location.replace("/auth/redefinir-senha");
        return;
      }
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Aplica a lista de organizações recebida do banco (chamado só depois da resposta).
  const applyOrgs = useCallback((forUserId: string, result: Awaited<ReturnType<typeof fetchOrgs>>, preferId?: string) => {
    if (result.error) { setError(result.error); setOrgState({ userId: forUserId, list: [] }); return; }
    const list = result.list;
    setOrgState({ userId: forUserId, list });
    let stored = "";
    try { stored = window.localStorage.getItem(ACTIVE_ORG_KEY) ?? ""; } catch { /* sem storage */ }
    const pick = [preferId, stored].find(id => id && list.some(o => o.id === id)) ?? list[0]?.id ?? "";
    setActiveId(pick);
  }, []);

  const loadOrgs = useCallback(async (forUserId: string, preferId?: string) => {
    applyOrgs(forUserId, await fetchOrgs(), preferId);
  }, [applyOrgs]);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchOrgs().then(result => { if (!cancelled) applyOrgs(userId, result); });
    return () => { cancelled = true; };
  }, [userId, applyOrgs]);
  const orgs = userId && orgState?.userId === userId ? orgState.list : null;

  useEffect(() => {
    try { if (activeId) window.localStorage.setItem(ACTIVE_ORG_KEY, activeId); } catch { /* sem storage */ }
  }, [activeId]);

  const active = orgs?.find(o => o.id === activeId);
  const repository = useMemo(() => (active ? supabaseRepository(active.id) : null), [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function logout() {
    await getSupabase().auth.signOut();
    setOrgState(null);
  }

  if (session === undefined) return <div className="center-screen muted">Carregando...</div>;
  if (!session) return <AuthScreen />;
  if (orgs === null) return <div className="center-screen muted">Carregando organizações...</div>;
  if (error && !orgs.length) return <div className="center-screen"><div className="alert error">{error}</div></div>;
  if (!active || !repository) {
    return <OrgSetup email={session.user.email ?? ""} onCreated={id => void loadOrgs(session.user.id, id)} onLogout={() => void logout()} />;
  }

  const header = (
    <div className="user-box">
      {orgs.length > 1 && (
        <select value={active.id} onChange={e => setActiveId(e.target.value)} aria-label="Organização ativa">
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}
      <span className="muted small" title={session.user.email}>{roleLabels[active.role]}</span>
      <button className="icon-button" onClick={() => void logout()} aria-label="Sair" title="Sair"><LogOut size={18} /></button>
    </div>
  );

  return (
    <CrmApp
      key={active.id}
      repository={repository}
      organization={active}
      header={header}
      team={<TeamPanel organization={active} currentUserId={session.user.id} />}
      settings={<SettingsPanel organization={active} onChanged={() => void loadOrgs(session.user.id, active.id)} />}
    />
  );
}
