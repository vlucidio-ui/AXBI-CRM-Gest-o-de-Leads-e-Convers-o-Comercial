"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { validateLead } from "@/lib/domain.mjs";
import { stages, urgencies, type Lead } from "@/lib/types";

type Props = {
  initial: Lead;
  readOnly: boolean;
  onSave: (lead: Lead) => Promise<void>;
  onClose: () => void;
};

export function LeadForm({ initial, readOnly, onSave, onClose }: Props) {
  const [lead, setLead] = useState<Lead>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const isNew = !initial.id;

  const set = <K extends keyof Lead>(key: K, value: Lead[K]) => setLead(prev => ({ ...prev, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found = validateLead(lead);
    setErrors(found);
    if (found.length) return;
    setSaving(true);
    try {
      await onSave(lead);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    } finally {
      setSaving(false);
    }
  }

  const text = (key: keyof Lead, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field">
      <span>{label}</span>
      <input value={String(lead[key] ?? "")} onChange={e => set(key, e.target.value as never)} disabled={readOnly} {...props} />
    </label>
  );

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="lead-form-title" onClick={onClose}>
      <form className="modal" onSubmit={submit} onClick={e => e.stopPropagation()}>
        <header className="modal-header">
          <h2 id="lead-form-title">{readOnly ? "Detalhes do lead" : isNew ? "Novo lead" : "Editar lead"}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </header>

        {errors.length > 0 && (
          <div className="alert error" role="alert">{errors.map(e => <div key={e}>{e}</div>)}</div>
        )}

        <div className="form-grid">
          {text("name", "Contato *", { required: true, maxLength: 200, autoFocus: true })}
          {text("company", "Empresa", { maxLength: 200 })}
          {text("email", "E-mail", { type: "email", maxLength: 320 })}
          {text("phone", "Telefone / WhatsApp", { type: "tel", maxLength: 40 })}
          {text("segment", "Segmento", { maxLength: 120 })}
          {text("source", "Canal de origem", { maxLength: 120, list: "sources", placeholder: "Instagram, indicação, site..." })}
          {text("campaign", "Campanha", { maxLength: 200 })}
          <label className="field">
            <span>Urgência</span>
            <select value={lead.urgency} onChange={e => set("urgency", e.target.value as Lead["urgency"])} disabled={readOnly}>
              {urgencies.map(u => <option key={u}>{u}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Etapa</span>
            <select value={lead.stage} onChange={e => set("stage", e.target.value as Lead["stage"])} disabled={readOnly}>
              {stages.map(s => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Valor potencial (R$)</span>
            <input type="number" min={0} step={100} value={lead.estimatedValue}
              onChange={e => set("estimatedValue", e.target.value === "" ? 0 : Number(e.target.value))} disabled={readOnly} />
          </label>
          <label className="field checkbox">
            <input type="checkbox" checked={lead.decisionMaker} onChange={e => set("decisionMaker", e.target.checked)} disabled={readOnly} />
            <span>Fala com quem decide</span>
          </label>
          <div />
          {text("nextAction", "Próxima ação", { maxLength: 500, placeholder: "Ligar, enviar proposta..." })}
          {text("nextActionDate", "Data da próxima ação", { type: "date" })}
          <label className="field wide">
            <span>Necessidade / dor</span>
            <textarea rows={2} maxLength={2000} value={lead.pain} onChange={e => set("pain", e.target.value)} disabled={readOnly} />
          </label>
          <label className="field wide">
            <span>Observações</span>
            <textarea rows={3} maxLength={10000} value={lead.notes} onChange={e => set("notes", e.target.value)} disabled={readOnly} />
          </label>
        </div>
        <datalist id="sources">
          {["Instagram", "Facebook", "Google", "Site", "Indicação", "WhatsApp", "LinkedIn", "Evento", "Formulário público"].map(s => <option key={s} value={s} />)}
        </datalist>

        <footer className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>{readOnly ? "Fechar" : "Cancelar"}</button>
          {!readOnly && <button type="submit" className="button primary" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</button>}
        </footer>
      </form>
    </div>
  );
}
