"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Download, FileUp, Printer, Send, Trash2, Undo2 } from "lucide-react";
import { buildDiagnostic, type Diagnostic } from "@/lib/diag/engine.mjs";
import { readSpedFile } from "@/lib/diag/read";
import type { ParsedSped } from "@/lib/diag/sped.mjs";
import { diagnosticXlsx, formatCnpj } from "@/lib/diag/workbook.mjs";
import { statusLabels, type DiagnosticRecord, type DiagnosticRepository, type DiagnosticStatus, type DiagnosticSummary } from "@/lib/diagRepository";
import { errorMessage } from "@/lib/supabase";
import { formatDate, type Lead, type Role } from "@/lib/types";
import { DiagnosticView } from "./DiagnosticView";

type Props = { repository: DiagnosticRepository; leads: Lead[]; role: Role };
type Draft = { result: Diagnostic; files: ParsedSped[] };

function download(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
const fileBase = (d: Diagnostic) => `diagnostico-${d.empresa.cnpj || "empresa"}-${d.anos[0] ?? ""}-${d.anos[d.anos.length - 1] ?? ""}`;

export function DiagnosticsPanel({ repository, leads, role }: Props) {
  const canEdit = role !== "viewer";
  const canApprove = role === "owner" || role === "admin";
  const [items, setItems] = useState<DiagnosticSummary[] | null>(null);
  const [current, setCurrent] = useState<DiagnosticRecord | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [title, setTitle] = useState("");
  const [leadId, setLeadId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    repository.list().then(
      list => { if (!cancelled) setItems(list); },
      err => { if (!cancelled) { setError(errorMessage(err)); setItems([]); } }
    );
    return () => { cancelled = true; };
  }, [repository]);

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label); setError("");
    try { return await fn(); } catch (err) { setError(errorMessage(err)); return undefined; } finally { setBusy(""); }
  }

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    await run("Lendo arquivos...", async () => {
      const files: ParsedSped[] = [];
      for (const file of Array.from(list)) files.push(await readSpedFile(file));
      const result = buildDiagnostic(files.filter(f => f.ok));
      setDraft({ result, files });
      setTitle(`Diagnóstico ${result.empresa.nome || ""} ${result.anos.length ? `${result.anos[0]}–${result.anos[result.anos.length - 1]}` : ""}`.replace(/\s+/g, " ").trim());
      setLeadId("");
    });
    if (input.current) input.current.value = "";
  }

  async function save() {
    if (!draft) return;
    const saved = await run("Salvando...", () => repository.create({ title, leadId, result: draft.result }));
    if (!saved) return;
    setItems(prev => [saved, ...(prev ?? [])]);
    setDraft(null);
    setNotes("");
    setCurrent(saved);
  }

  async function open(id: string) {
    const record = await run("Abrindo...", () => repository.get(id));
    if (record) { setCurrent(record); setNotes(record.reviewNotes); }
  }

  async function setStatus(status: DiagnosticStatus) {
    if (!current) return;
    const updated = await run("Atualizando...", () => repository.update(current.id, { status, reviewNotes: notes }));
    if (!updated) return;
    setCurrent({ ...current, ...updated });
    setItems(prev => (prev ?? []).map(i => (i.id === updated.id ? updated : i)));
  }

  async function remove(id: string) {
    if (!window.confirm("Excluir este diagnóstico? Esta ação não pode ser desfeita.")) return;
    const ok = await run("Excluindo...", async () => { await repository.remove(id); return true; });
    if (!ok) return;
    setItems(prev => (prev ?? []).filter(i => i.id !== id));
    setCurrent(null);
  }

  const alerts = <>{error && <div className="alert error no-print" role="alert">{error}</div>}{busy && <p className="muted no-print" role="status">{busy}</p>}</>;

  // ---------------------------------------------------------------- prévia (ainda não salvo)
  if (draft) {
    const rejected = draft.files.filter(f => !f.ok);
    return (
      <div>
        {alerts}
        <section className="panel no-print">
          <h3>Novo diagnóstico — conferir antes de salvar</h3>
          {rejected.length > 0 && (
            <div className="alert error" role="alert">
              {rejected.length} arquivo(s) não foram aceitos:
              <ul>{rejected.map(f => <li key={f.fileName}><strong>{f.fileName}</strong>: {f.error}</li>)}</ul>
            </div>
          )}
          <div className="form-grid">
            <label className="field wide"><span>Título</span><input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} required /></label>
            <label className="field wide"><span>Cliente / lead (opcional)</span>
              <select value={leadId} onChange={e => setLeadId(e.target.value)}>
                <option value="">Sem vínculo</option>
                {leads.map(l => <option key={l.id} value={l.id}>{l.company ? `${l.company} — ${l.name}` : l.name}</option>)}
              </select>
            </label>
          </div>
          <div className="toolbar">
            <button className="button primary" onClick={() => void save()} disabled={!!busy || !title.trim() || !draft.result.anos.length}>Salvar como rascunho</button>
            <button className="button secondary" onClick={() => setDraft(null)} disabled={!!busy}>Descartar</button>
          </div>
        </section>
        <DiagnosticView diagnostic={draft.result} draft />
      </div>
    );
  }

  // ---------------------------------------------------------------- diagnóstico aberto
  if (current) {
    const d = current.result;
    const approved = current.status === "aprovado";
    return (
      <div>
        {alerts}
        <section className="panel no-print">
          <div className="toolbar">
            <button className="button secondary" onClick={() => setCurrent(null)}><ArrowLeft size={16} /> Voltar</button>
            <button className="button secondary" onClick={() => download(diagnosticXlsx(d), `${fileBase(d)}.xlsx`)}><Download size={16} /> Planilha (.xlsx)</button>
            <button className="button secondary" onClick={() => window.print()}><Printer size={16} /> Relatório (imprimir / PDF)</button>
            {canEdit && current.status === "rascunho" && <button className="button primary" onClick={() => void setStatus("em_revisao")} disabled={!!busy}><Send size={16} /> Enviar para revisão</button>}
            {canEdit && current.status === "em_revisao" && <button className="button secondary" onClick={() => void setStatus("rascunho")} disabled={!!busy}><Undo2 size={16} /> Voltar para rascunho</button>}
            {canApprove && current.status === "em_revisao" && <button className="button primary" onClick={() => void setStatus("aprovado")} disabled={!!busy}><CheckCircle2 size={16} /> Aprovar</button>}
            {canApprove && <button className="icon-button danger" onClick={() => void remove(current.id)} aria-label="Excluir diagnóstico" title="Excluir"><Trash2 size={18} /></button>}
          </div>
          <p><strong>{current.title}</strong> · <span className={approved ? "pill" : "pill pill-today"}>{statusLabels[current.status]}</span>
            {approved && current.reviewedAt ? <span className="muted small"> · aprovado em {formatDate(current.reviewedAt)}</span> : null}</p>
          {!approved && canEdit && (
            <label className="field"><span>Observações da revisão (ficam registradas ao mudar o status)</span>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={5000} rows={2} />
            </label>
          )}
          {approved && current.reviewNotes && <p className="muted small">Observações da revisão: {current.reviewNotes}</p>}
          {current.status === "em_revisao" && !canApprove && <p className="muted small">Aguardando aprovação de um proprietário ou administrador.</p>}
        </section>
        <DiagnosticView diagnostic={d} draft={!approved} />
      </div>
    );
  }

  // ---------------------------------------------------------------- lista
  return (
    <div>
      {alerts}
      <section className="panel">
        <h3>Diagnósticos contábeis</h3>
        <p className="muted">Envie as escriturações do cliente (ECF e ECD, arquivos .txt do SPED, de um ou mais anos). O CRM calcula DRE, balanço, indicadores, conciliação ECD × ECF, achados e plano de ação, e gera a planilha e o relatório.</p>
        <p className="muted small">Os arquivos são lidos neste computador e não são enviados nem armazenados: só o resultado calculado é salvo. Todo diagnóstico nasce como rascunho e precisa de aprovação antes da entrega.</p>
        {canEdit && (
          <div className="toolbar">
            <input ref={input} type="file" accept=".txt,text/plain" multiple hidden onChange={e => void onFiles(e.target.files)} />
            <button className="button primary" onClick={() => input.current?.click()} disabled={!!busy}><FileUp size={16} /> Novo diagnóstico: selecionar arquivos</button>
          </div>
        )}
      </section>
      {items === null ? <p className="muted">Carregando...</p> : items.length === 0 ? (
        <p className="muted center">Nenhum diagnóstico ainda.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Título</th><th>Empresa</th><th>Exercícios</th><th>Status</th><th>Criado em</th><th /></tr></thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id}>
                  <td><button className="link" onClick={() => void open(i.id)}>{i.title}</button></td>
                  <td>{i.companyName || "—"}<br /><span className="muted small">{formatCnpj(i.cnpj)}</span></td>
                  <td>{i.years.join(", ")}</td>
                  <td><span className={i.status === "aprovado" ? "pill" : "pill pill-today"}>{statusLabels[i.status]}</span></td>
                  <td>{formatDate(i.createdAt)}</td>
                  <td>{canApprove && <button className="icon-button danger" onClick={() => void remove(i.id)} aria-label={`Excluir ${i.title}`} title="Excluir"><Trash2 size={16} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
