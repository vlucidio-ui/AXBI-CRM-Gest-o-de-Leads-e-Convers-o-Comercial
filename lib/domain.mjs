export const STAGES = [
  "Novo lead", "Em qualificação", "Qualificado", "Diagnóstico agendado",
  "Diagnóstico realizado", "Proposta enviada", "Negociação", "Fechado", "Perdido", "Nutrição"
];
export const URGENCIES = ["Imediata", "Até 30 dias", "Até 90 dias", "Sem prazo"];

export const QUALIFIED_STAGES = new Set([
  "Qualificado", "Diagnóstico agendado", "Diagnóstico realizado",
  "Proposta enviada", "Negociação", "Fechado"
]);
export const CLOSED_STAGES = new Set(["Fechado", "Perdido"]);
export const DECISION_STAGES = new Set(["Proposta enviada", "Negociação", "Fechado", "Perdido"]);

export const LEAD_FIELDS = [
  "id", "name", "company", "email", "phone", "segment", "source", "campaign", "pain",
  "urgency", "decisionMaker", "estimatedValue", "stage", "nextAction", "nextActionDate",
  "notes", "createdAt", "updatedAt"
];

export function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** UUID v4 completo, compatível com a coluna uuid do Postgres. */
export function createLeadId(randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)) {
  if (randomUUID) return randomUUID();
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isLeadRecord(value, validStages = STAGES) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const textFields = ["id","name","company","email","phone","segment","source","campaign","pain","urgency","stage","nextAction","nextActionDate","notes","createdAt","updatedAt"];
  return textFields.every(k => typeof value[k] === "string")
    && typeof value.decisionMaker === "boolean"
    && typeof value.estimatedValue === "number" && Number.isFinite(value.estimatedValue)
    && value.estimatedValue >= 0
    && validStages.includes(value.stage)
    && URGENCIES.includes(value.urgency);
}

export function emptyLead(now = new Date()) {
  const iso = now.toISOString();
  return {
    id: "", name: "", company: "", email: "", phone: "", segment: "", source: "", campaign: "",
    pain: "", urgency: "Sem prazo", decisionMaker: false, estimatedValue: 0, stage: "Novo lead",
    nextAction: "", nextActionDate: "", notes: "", createdAt: iso, updatedAt: iso
  };
}

/** Retorna a lista de erros de validação (vazia quando o lead é válido). */
export function validateLead(lead) {
  const errors = [];
  if (!String(lead.name ?? "").trim()) errors.push("Informe o nome do contato.");
  if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) errors.push("E-mail inválido.");
  if (!Number.isFinite(lead.estimatedValue) || lead.estimatedValue < 0) errors.push("Valor potencial deve ser zero ou positivo.");
  if (!STAGES.includes(lead.stage)) errors.push("Etapa inválida.");
  if (!URGENCIES.includes(lead.urgency)) errors.push("Urgência inválida.");
  if (lead.nextActionDate && !/^\d{4}-\d{2}-\d{2}$/.test(lead.nextActionDate)) errors.push("Data da próxima ação inválida.");
  return errors;
}

export function calculateMetrics(leads) {
  const active = leads.filter(l => !CLOSED_STAGES.has(l.stage));
  const won = leads.filter(l => l.stage === "Fechado");
  const decisions = leads.filter(l => DECISION_STAGES.has(l.stage));
  const qualified = leads.filter(l => QUALIFIED_STAGES.has(l.stage));
  const proposalValue = leads.filter(l => ["Proposta enviada","Negociação"].includes(l.stage)).reduce((s,l)=>s+l.estimatedValue,0);
  const contracted = won.reduce((s,l)=>s+l.estimatedValue,0);
  return { total:leads.length, active:active.length, qualified:qualified.length, won:won.length, contracted, proposalValue,
    closeRate:decisions.length ? Math.round(won.length / decisions.length * 100) : 0 };
}

export function filterLeads(leads, query = "", stage = "Todas") {
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  return leads.filter(l => {
    const matches = !normalized || [l.name,l.company,l.email,l.phone,l.source,l.pain,l.campaign]
      .some(v => String(v ?? "").toLocaleLowerCase("pt-BR").includes(normalized));
    return matches && (stage === "Todas" || l.stage === stage);
  });
}

/** Follow-ups pendentes de leads em aberto, ordenados por data. */
export function followUps(leads, today = localDate()) {
  return leads
    .filter(l => !CLOSED_STAGES.has(l.stage) && l.nextActionDate)
    .map(l => ({ lead: l, overdue: l.nextActionDate < today, isToday: l.nextActionDate === today }))
    .sort((a, b) => a.lead.nextActionDate.localeCompare(b.lead.nextActionDate));
}

/** Quantidade, ganhos e valor fechado por canal de origem. */
export function sourceBreakdown(leads) {
  const map = new Map();
  for (const l of leads) {
    const key = l.source.trim() || "Não informado";
    const row = map.get(key) ?? { source: key, total: 0, won: 0, contracted: 0 };
    row.total += 1;
    if (l.stage === "Fechado") { row.won += 1; row.contracted += l.estimatedValue; }
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.source.localeCompare(b.source));
}

export function leadsToCsv(leads) {
  const quote = value => {
    let text = String(value ?? "");
    if (/^[\s]*[=+@\-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g,'""')}"`;
  };
  return [LEAD_FIELDS.join(";"), ...leads.map(l => LEAD_FIELDS.map(k => quote(l[k])).join(";"))].join("\r\n");
}

/** Converte um lead da interface para uma linha da tabela crm_leads. */
export function leadToRow(lead, organizationId) {
  return {
    id: lead.id,
    organization_id: organizationId,
    name: lead.name.trim(),
    company: lead.company, email: lead.email.trim().toLowerCase(), phone: lead.phone,
    segment: lead.segment, source: lead.source, campaign: lead.campaign, pain: lead.pain,
    urgency: lead.urgency, decision_maker: lead.decisionMaker,
    estimated_value: lead.estimatedValue, stage: lead.stage,
    next_action: lead.nextAction, next_action_date: lead.nextActionDate || null,
    notes: lead.notes
  };
}

/** Converte uma linha da tabela crm_leads para o formato da interface. */
export function rowToLead(row) {
  return {
    id: row.id, name: row.name ?? "", company: row.company ?? "", email: row.email ?? "",
    phone: row.phone ?? "", segment: row.segment ?? "", source: row.source ?? "",
    campaign: row.campaign ?? "", pain: row.pain ?? "", urgency: row.urgency ?? "Sem prazo",
    decisionMaker: Boolean(row.decision_maker), estimatedValue: Number(row.estimated_value ?? 0),
    stage: row.stage, nextAction: row.next_action ?? "", nextActionDate: row.next_action_date ?? "",
    notes: row.notes ?? "", createdAt: row.created_at ?? "", updatedAt: row.updated_at ?? ""
  };
}
