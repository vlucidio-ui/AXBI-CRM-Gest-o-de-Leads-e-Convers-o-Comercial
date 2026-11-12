import type { Diagnostic } from "./diag/engine.mjs";
import { getSupabase } from "./supabase";

export type DiagnosticStatus = "rascunho" | "em_revisao" | "aprovado";
export const statusLabels: Record<DiagnosticStatus, string> = { rascunho: "Rascunho", em_revisao: "Em revisão", aprovado: "Aprovado" };

export type DiagnosticSummary = {
  id: string; title: string; leadId: string; companyName: string; cnpj: string; years: number[];
  engineVersion: string; status: DiagnosticStatus; reviewNotes: string; createdAt: string; reviewedAt: string;
};
export type DiagnosticRecord = DiagnosticSummary & { result: Diagnostic };
export type DiagnosticInput = { title: string; leadId: string; result: Diagnostic };
export type DiagnosticPatch = { status?: DiagnosticStatus; reviewNotes?: string };

export interface DiagnosticRepository {
  list(): Promise<DiagnosticSummary[]>;
  get(id: string): Promise<DiagnosticRecord>;
  create(input: DiagnosticInput): Promise<DiagnosticRecord>;
  update(id: string, patch: DiagnosticPatch): Promise<DiagnosticSummary>;
  remove(id: string): Promise<void>;
}

const SUMMARY = "id,title,lead_id,company_name,cnpj,years,engine_version,status,review_notes,created_at,reviewed_at";
type Row = {
  id: string; title: string; lead_id: string | null; company_name: string; cnpj: string; years: number[];
  engine_version: string; status: DiagnosticStatus; review_notes: string; created_at: string; reviewed_at: string | null; result?: Diagnostic;
};
const toSummary = (r: Row): DiagnosticSummary => ({
  id: r.id, title: r.title, leadId: r.lead_id ?? "", companyName: r.company_name, cnpj: r.cnpj, years: r.years ?? [],
  engineVersion: r.engine_version, status: r.status, reviewNotes: r.review_notes ?? "", createdAt: r.created_at, reviewedAt: r.reviewed_at ?? ""
});

/** Diagnósticos no Supabase, limitados à organização ativa e protegidos por RLS e gatilhos do banco. */
export function supabaseDiagnosticRepository(organizationId: string): DiagnosticRepository {
  const table = () => getSupabase().from("crm_diagnostics");
  return {
    async list() {
      const { data, error } = await table().select(SUMMARY).eq("organization_id", organizationId).order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as Row[]).map(toSummary);
    },
    async get(id) {
      const { data, error } = await table().select(SUMMARY + ",result").eq("id", id).eq("organization_id", organizationId).single();
      if (error) throw error;
      const row = data as unknown as Row;
      return { ...toSummary(row), result: row.result as Diagnostic };
    },
    async create(input) {
      const d = input.result;
      const { data, error } = await table().insert({
        organization_id: organizationId, lead_id: input.leadId || null, title: input.title.trim().slice(0, 200),
        company_name: d.empresa.nome.slice(0, 200), cnpj: /^\d{14}$/.test(d.empresa.cnpj) ? d.empresa.cnpj : "",
        years: d.anos, engine_version: d.versao, result: d
      }).select(SUMMARY + ",result").single();
      if (error) throw error;
      const row = data as unknown as Row;
      return { ...toSummary(row), result: row.result as Diagnostic };
    },
    async update(id, patch) {
      const body: Record<string, unknown> = {};
      if (patch.status) body.status = patch.status;
      if (patch.reviewNotes !== undefined) body.review_notes = patch.reviewNotes.slice(0, 5000);
      const { data, error } = await table().update(body).eq("id", id).eq("organization_id", organizationId).select(SUMMARY).single();
      if (error) throw error;
      return toSummary(data as unknown as Row);
    },
    async remove(id) {
      const { error } = await table().delete().eq("id", id).eq("organization_id", organizationId);
      if (error) throw error;
    }
  };
}

/** Modo demonstração: guarda só na memória da aba (nada vai para o disco nem para a rede). */
export function memoryDiagnosticRepository(): DiagnosticRepository {
  let items: DiagnosticRecord[] = [];
  const find = (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) throw new Error("Diagnóstico não encontrado.");
    return item;
  };
  return {
    async list() { return items.map(({ result: _result, ...summary }) => summary); },
    async get(id) { return find(id); },
    async create(input) {
      const d = input.result;
      const record: DiagnosticRecord = {
        id: crypto.randomUUID(), title: input.title.trim().slice(0, 200), leadId: input.leadId, companyName: d.empresa.nome, cnpj: d.empresa.cnpj,
        years: d.anos, engineVersion: d.versao, status: "rascunho", reviewNotes: "", createdAt: new Date().toISOString(), reviewedAt: "", result: d
      };
      items = [record, ...items];
      return record;
    },
    async update(id, patch) {
      const cur = find(id);
      if (cur.status === "aprovado") throw new Error("Diagnóstico aprovado não pode ser alterado. Gere uma nova versão.");
      if (patch.status === "aprovado" && cur.status !== "em_revisao") throw new Error("Envie o diagnóstico para revisão antes de aprovar.");
      const next = { ...cur, ...(patch.status ? { status: patch.status } : {}), ...(patch.reviewNotes !== undefined ? { reviewNotes: patch.reviewNotes } : {}),
        reviewedAt: patch.status === "aprovado" ? new Date().toISOString() : "" };
      items = items.map(i => (i.id === id ? next : i));
      const { result: _result, ...summary } = next;
      return summary;
    },
    async remove(id) { items = items.filter(i => i.id !== id); }
  };
}
