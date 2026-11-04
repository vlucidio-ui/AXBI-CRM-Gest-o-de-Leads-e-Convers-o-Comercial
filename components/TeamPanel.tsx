"use client";

import { useCallback, useEffect, useState } from "react";
import { errorMessage, getSupabase } from "@/lib/supabase";
import { roleLabels, type Organization, type Role } from "@/lib/types";

type Member = { user_id: string; email: string; role: Role; created_at: string };

export function TeamPanel({ organization, currentUserId }: { organization: Organization; currentUserId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const canManage = organization.role === "owner" || organization.role === "admin";

  const load = useCallback(async () => {
    const { data, error } = await getSupabase().rpc("crm_list_members", { p_org: organization.id });
    if (error) setError(errorMessage(error)); else setMembers((data ?? []) as Member[]);
  }, [organization.id]);

  useEffect(() => { void load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setMessage("");
    const { error } = await getSupabase().rpc("crm_add_member_by_email", { p_org: organization.id, p_email: email, p_role: role });
    if (error) return setError(errorMessage(error));
    setMessage(`${email} agora faz parte da equipe.`);
    setEmail("");
    void load();
  }

  async function changeRole(member: Member, next: Role) {
    setError("");
    const { error } = await getSupabase().from("crm_members").update({ role: next })
      .eq("organization_id", organization.id).eq("user_id", member.user_id);
    if (error) setError(errorMessage(error));
    void load();
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`Remover ${member.email} da equipe?`)) return;
    const { error } = await getSupabase().from("crm_members").delete()
      .eq("organization_id", organization.id).eq("user_id", member.user_id);
    if (error) setError(errorMessage(error));
    void load();
  }

  const editable = (m: Member) => canManage && m.user_id !== currentUserId && (organization.role === "owner" || m.role !== "owner");

  return (
    <section className="panel">
      <h3>Equipe</h3>
      {error && <div className="alert error" role="alert">{error}</div>}
      {message && <div className="alert success" role="status">{message}</div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>E-mail</th><th>Papel</th><th></th></tr></thead>
          <tbody>
            {members.map(m => (
              <tr key={m.user_id}>
                <td>{m.email}{m.user_id === currentUserId && <span className="muted"> (você)</span>}</td>
                <td>
                  {editable(m) ? (
                    <select value={m.role} onChange={e => void changeRole(m, e.target.value as Role)}>
                      {(organization.role === "owner" ? ["owner", "admin", "member", "viewer"] : ["admin", "member", "viewer"]).map(r =>
                        <option key={r} value={r}>{roleLabels[r as Role]}</option>)}
                    </select>
                  ) : roleLabels[m.role]}
                </td>
                <td>{editable(m) && <button className="link danger" onClick={() => void removeMember(m)}>Remover</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage && (
        <form className="inline-form" onSubmit={add}>
          <input type="email" required placeholder="email@empresa.com" value={email} onChange={e => setEmail(e.target.value)} aria-label="E-mail do novo membro" />
          <select value={role} onChange={e => setRole(e.target.value as Role)} aria-label="Papel">
            {(["admin", "member", "viewer"] as Role[]).map(r => <option key={r} value={r}>{roleLabels[r]}</option>)}
          </select>
          <button className="button primary">Adicionar</button>
        </form>
      )}
      <p className="muted small">A pessoa precisa criar a conta no CRM antes de ser adicionada. Vendedores criam e editam leads; somente proprietários e administradores excluem leads e gerenciam a equipe.</p>
    </section>
  );
}
