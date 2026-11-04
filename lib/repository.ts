import { isLeadRecord, leadToRow, rowToLead } from "./domain.mjs";
import { getSupabase } from "./supabase";
import { stages, type Lead } from "./types";

export interface LeadRepository {
  list(): Promise<Lead[]>;
  save(lead: Lead): Promise<Lead>;
  remove(id: string): Promise<void>;
}

const STORAGE_KEY = "axbi-crm-leads-v1";

/** Persistência no navegador. Usado quando o Supabase não está configurado. */
export const localRepository: LeadRepository = {
  async list() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((l): l is Lead => isLeadRecord(l, stages)) : [];
    } catch {
      return [];
    }
  },
  async save(lead) {
    const all = await this.list();
    const saved = { ...lead, updatedAt: new Date().toISOString() };
    const next = all.some(l => l.id === lead.id) ? all.map(l => (l.id === lead.id ? saved : l)) : [saved, ...all];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return saved;
  },
  async remove(id) {
    const all = await this.list();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all.filter(l => l.id !== id)));
  }
};

/** Persistência no Supabase, sempre limitada à organização ativa (e protegida por RLS). */
export function supabaseRepository(organizationId: string): LeadRepository {
  const table = () => getSupabase().from("crm_leads");
  return {
    async list() {
      const { data, error } = await table()
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(rowToLead);
    },
    async save(lead) {
      const { data, error } = await table()
        .upsert(leadToRow(lead, organizationId))
        .select("*")
        .single();
      if (error) throw error;
      return rowToLead(data);
    },
    async remove(id) {
      const { error } = await table().delete().eq("id", id).eq("organization_id", organizationId);
      if (error) throw error;
    }
  };
}
