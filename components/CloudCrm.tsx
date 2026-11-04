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

export function CloudCrm() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [orgs, setOrgs] = useState<Organization[] | null>(null);
  const [activeId, setActiveId] = useState<string>("");
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const loadOrgs = useCallback(async (preferId?: string) => {
    const { data, error } = await getSupabase().rpc("crm_my_organizations");
    if (error) { setError(errorMessage(error)); setOrgs([]); return; }
    const list: Organization[] = (data ?? []).map((o: { id: string; name: string; slug: string; role: Role; public_form_enabled: boolean }) => ({
      id: o.id, name: o.name, slug: o.slug, role: o.role, publicFormEnabled: o.public_form_enabled
    }));
    setOrgs(list);
    let stored = "";
    try { stored = window.localStorage.getItem(ACTIVE_ORG_KEY) ?? ""; } catch { /* sem storage */ }
    const pick = [preferId, stored].find(id => id && list.some(o => o.id === id)) ?? list[0]?.id ?? "";
    setActiveId(pick);
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (userId) void loadOrgs(); else setOrgs(null);
  }, [userId, loadOrgs]);

  useEffect(() => {
    try { if (activeId) window.localStorage.setItem(ACTIVE_ORG_KEY, activeId); } catch { /* sem storage */ }
  }, [activeId]);

  const active = orgs?.find(o => o.id === activeId);
  const repository = useMemo(() => (active ? supabaseRepository(active.id) : null), [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function logout() {
    await getSupabase().auth.signOut();
    setOrgs(null);
  }

  if (session === undefined) return <div className="center-screen muted">Carregando...</div>;
  if (!session) return <AuthScreen />;
  if (orgs === null) return <div className="center-screen muted">Carregando organizações...</div>;
  if (error && !orgs.length) return <div className="center-screen"><div className="alert error">{error}</div></div>;
  if (!active || !repository) {
    return <OrgSetup email={session.user.email ?? ""} onCreated={id => void loadOrgs(id)} onLogout={() => void logout()} />;
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
      settings={<SettingsPanel organization={active} onChanged={() => void loadOrgs(active.id)} />}
    />
  );
}
