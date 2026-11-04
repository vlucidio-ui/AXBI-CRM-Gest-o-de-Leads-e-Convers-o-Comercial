"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CalendarClock, Download, KanbanSquare, LayoutDashboard, List, Plus,
  Search, Settings, Share2, Trash2, Users
} from "lucide-react";
import {
  calculateMetrics, createLeadId, emptyLead, filterLeads, followUps, leadsToCsv, localDate, sourceBreakdown
} from "@/lib/domain.mjs";
import type { LeadRepository } from "@/lib/repository";
import { errorMessage } from "@/lib/supabase";
import { formatDate, money, stages, type Lead, type Organization, type Stage } from "@/lib/types";
import { LeadForm } from "./LeadForm";

type Tab = "dashboard" | "pipeline" | "leads" | "followups" | "sources" | "team" | "settings";

type Props = {
  repository: LeadRepository;
  organization?: Organization;
  header?: React.ReactNode;
  team?: React.ReactNode;
  settings?: React.ReactNode;
};

export function CrmApp({ repository, organization, header, team, settings }: Props) {
  const role = organization?.role ?? "owner";
  const canEdit = role !== "viewer";
  const canDelete = role === "owner" || role === "admin";

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("Todas");
  const [editing, setEditing] = useState<Lead | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setLeads(await repository.list());
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => { void reload(); }, [reload]);

  const metrics = useMemo(() => calculateMetrics(leads), [leads]);
  const visible = useMemo(() => filterLeads(leads, query, stageFilter), [leads, query, stageFilter]);
  const today = localDate();
  const pending = useMemo(() => followUps(leads, today), [leads, today]);
  const overdueCount = pending.filter(f => f.overdue).length;
  const sources = useMemo(() => sourceBreakdown(leads), [leads]);

  async function save(lead: Lead) {
    try {
      const toSave = lead.id ? lead : { ...lead, id: createLeadId() };
      const saved = await repository.save(toSave);
      setLeads(prev => prev.some(l => l.id === saved.id) ? prev.map(l => l.id === saved.id ? saved : l) : [saved, ...prev]);
      setEditing(null);
    } catch (err) {
      throw new Error(errorMessage(err));
    }
  }

  async function moveStage(lead: Lead, stage: Stage) {
    if (!canEdit || lead.stage === stage) return;
    const previous = leads;
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, stage } : l));
    try {
      const saved = await repository.save({ ...lead, stage });
      setLeads(prev => prev.map(l => l.id === saved.id ? saved : l));
    } catch (err) {
      setLeads(previous);
      setError(errorMessage(err));
    }
  }

  async function remove(lead: Lead) {
    if (!canDelete) return;
    if (!window.confirm(`Excluir o lead "${lead.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await repository.remove(lead.id);
      setLeads(prev => prev.filter(l => l.id !== lead.id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function exportCsv() {
    const blob = new Blob(["﻿" + leadsToCsv(visible)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "dashboard", label: "Painel", icon: <LayoutDashboard size={16} /> },
    { id: "pipeline", label: "Pipeline", icon: <KanbanSquare size={16} /> },
    { id: "leads", label: "Leads", icon: <List size={16} /> },
    { id: "followups", label: "Follow-ups", icon: <CalendarClock size={16} />, badge: overdueCount || undefined },
    { id: "sources", label: "Origens", icon: <Share2 size={16} /> },
    ...(team ? [{ id: "team" as Tab, label: "Equipe", icon: <Users size={16} /> }] : []),
    ...(settings ? [{ id: "settings" as Tab, label: "Configurações", icon: <Settings size={16} /> }] : [])
  ];

  const open = (lead: Lead) => setEditing(lead);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="logo">AX</span>
          <div>
            <strong>AXBI CRM</strong>
            <small>{organization ? organization.name : "Gestão de leads e conversão comercial"}</small>
          </div>
        </div>
        <div className="topbar-actions">
          {canEdit && (
            <button className="button primary" onClick={() => setEditing(emptyLead())}>
              <Plus size={16} /> Novo lead
            </button>
          )}
          {header}
        </div>
      </header>

      <nav className="tabs" aria-label="Seções">
        {tabs.map(t => (
          <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}>
            {t.icon}<span>{t.label}</span>{t.badge ? <span className="badge">{t.badge}</span> : null}
          </button>
        ))}
      </nav>

      <main className="content">
        {error && <div className="alert error" role="alert">{error} <button className="link" onClick={() => void reload()}>Tentar de novo</button></div>}
        {loading && <div className="muted">Carregando leads...</div>}

        {!loading && tab === "dashboard" && (
          <section>
            <div className="kpis">
              <Kpi label="Leads cadastrados" value={String(metrics.total)} />
              <Kpi label="Em andamento" value={String(metrics.active)} />
              <Kpi label="Qualificados" value={String(metrics.qualified)} />
              <Kpi label="Fechados" value={String(metrics.won)} />
              <Kpi label="Receita contratada" value={money(metrics.contracted)} hint="Soma dos leads em Fechado" />
              <Kpi label="Pipeline em negociação" value={money(metrics.proposalValue)} hint="Proposta enviada + Negociação" />
              <Kpi label="Taxa de fechamento" value={`${metrics.closeRate}%`} hint="Fechado ÷ (Proposta + Negociação + Fechado + Perdido)" />
              <Kpi label="Follow-ups atrasados" value={String(overdueCount)} alert={overdueCount > 0} />
            </div>
            <div className="panel">
              <h3>Leads por etapa</h3>
              <div className="bars">
                {stages.map(s => {
                  const count = leads.filter(l => l.stage === s).length;
                  const pct = metrics.total ? (count / metrics.total) * 100 : 0;
                  return (
                    <div className="bar-row" key={s}>
                      <span className="bar-label">{s}</span>
                      <span className="bar-track"><span className="bar-fill" style={{ width: `${pct}%` }} /></span>
                      <span className="bar-value">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            {leads.length === 0 && <EmptyState canEdit={canEdit} onNew={() => setEditing(emptyLead())} />}
          </section>
        )}

        {!loading && tab === "pipeline" && (
          <section className="kanban" aria-label="Pipeline">
            {stages.map(stage => {
              const items = leads.filter(l => l.stage === stage);
              const total = items.reduce((s, l) => s + l.estimatedValue, 0);
              return (
                <div key={stage} className="column"
                  onDragOver={e => { if (canEdit) e.preventDefault(); }}
                  onDrop={() => { const lead = leads.find(l => l.id === dragId); if (lead) void moveStage(lead, stage); setDragId(null); }}>
                  <header>
                    <strong>{stage}</strong>
                    <span className="muted">{items.length} · {money(total)}</span>
                  </header>
                  {items.map(lead => (
                    <article key={lead.id} className="card" draggable={canEdit}
                      onDragStart={() => setDragId(lead.id)} onDragEnd={() => setDragId(null)}>
                      <button className="card-title" onClick={() => open(lead)}>{lead.name}</button>
                      <div className="muted">{lead.company || "—"}</div>
                      <div className="card-meta">
                        <span>{money(lead.estimatedValue)}</span>
                        {lead.nextActionDate && <span className={lead.nextActionDate < today ? "late" : ""}>{formatDate(lead.nextActionDate)}</span>}
                      </div>
                      {canEdit && (
                        <select aria-label={`Mover ${lead.name}`} value={lead.stage} onChange={e => void moveStage(lead, e.target.value as Stage)}>
                          {stages.map(s => <option key={s}>{s}</option>)}
                        </select>
                      )}
                    </article>
                  ))}
                </div>
              );
            })}
          </section>
        )}

        {!loading && tab === "leads" && (
          <section>
            <div className="toolbar">
              <label className="search">
                <Search size={16} />
                <input placeholder="Buscar por contato, empresa, e-mail, telefone, canal, campanha..." value={query} onChange={e => setQuery(e.target.value)} />
              </label>
              <select value={stageFilter} onChange={e => setStageFilter(e.target.value)} aria-label="Filtrar por etapa">
                <option>Todas</option>
                {stages.map(s => <option key={s}>{s}</option>)}
              </select>
              <button className="button secondary" onClick={exportCsv} disabled={!visible.length}><Download size={16} /> Exportar CSV</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Contato</th><th>Empresa</th><th>Canal</th><th>Etapa</th><th>Valor</th><th>Próxima ação</th><th></th></tr>
                </thead>
                <tbody>
                  {visible.map(lead => (
                    <tr key={lead.id}>
                      <td><button className="link" onClick={() => open(lead)}>{lead.name}</button><div className="muted small">{lead.email || lead.phone}</div></td>
                      <td>{lead.company}</td>
                      <td>{lead.source}</td>
                      <td><span className="pill">{lead.stage}</span></td>
                      <td>{money(lead.estimatedValue)}</td>
                      <td>{lead.nextAction}{lead.nextActionDate && <div className={`small ${lead.nextActionDate < today ? "late" : "muted"}`}>{formatDate(lead.nextActionDate)}</div>}</td>
                      <td>{canDelete && <button className="icon-button danger" onClick={() => void remove(lead)} aria-label={`Excluir ${lead.name}`}><Trash2 size={16} /></button>}</td>
                    </tr>
                  ))}
                  {!visible.length && <tr><td colSpan={7} className="muted center">Nenhum lead encontrado.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {!loading && tab === "followups" && (
          <section className="panel">
            <h3>Próximas ações</h3>
            {!pending.length && <p className="muted">Nenhum follow-up agendado para leads em aberto.</p>}
            <ul className="followups">
              {pending.map(({ lead, overdue, isToday }) => (
                <li key={lead.id} className={overdue ? "overdue" : isToday ? "today" : ""}>
                  {overdue && <AlertTriangle size={16} />}
                  <span className="date">{formatDate(lead.nextActionDate)}</span>
                  <button className="link" onClick={() => open(lead)}>{lead.name}</button>
                  <span className="muted">{lead.company}</span>
                  <span>{lead.nextAction || "Sem ação definida"}</span>
                  <span className="pill">{overdue ? "Atrasado" : isToday ? "Hoje" : lead.stage}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && tab === "sources" && (
          <section className="panel">
            <h3>Origem dos leads por canal</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Canal</th><th>Leads</th><th>% do total</th><th>Fechados</th><th>Conversão</th><th>Receita contratada</th></tr></thead>
                <tbody>
                  {sources.map(s => (
                    <tr key={s.source}>
                      <td>{s.source}</td><td>{s.total}</td>
                      <td>{metrics.total ? Math.round(s.total / metrics.total * 100) : 0}%</td>
                      <td>{s.won}</td><td>{Math.round(s.won / s.total * 100)}%</td><td>{money(s.contracted)}</td>
                    </tr>
                  ))}
                  {!sources.length && <tr><td colSpan={6} className="muted center">Sem dados ainda.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === "team" && team}
        {tab === "settings" && settings}
      </main>

      {editing && (
        <LeadForm initial={editing} readOnly={!canEdit} onSave={save} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function Kpi({ label, value, hint, alert }: { label: string; value: string; hint?: string; alert?: boolean }) {
  return (
    <div className={`kpi ${alert ? "alert-kpi" : ""}`} title={hint}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({ canEdit, onNew }: { canEdit: boolean; onNew: () => void }) {
  return (
    <div className="panel center">
      <h3>Nenhum lead ainda</h3>
      <p className="muted">Cadastre o primeiro lead para começar a acompanhar o funil.</p>
      {canEdit && <button className="button primary" onClick={onNew}><Plus size={16} /> Cadastrar lead</button>}
    </div>
  );
}
