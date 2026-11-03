export const QUALIFIED_STAGES = new Set([
  "Qualificado", "Diagnóstico agendado", "Diagnóstico realizado",
  "Proposta enviada", "Negociação", "Fechado"
]);
export const CLOSED_STAGES = new Set(["Fechado", "Perdido"]);
export const DECISION_STAGES = new Set(["Proposta enviada", "Negociação", "Fechado", "Perdido"]);

export function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
export function createLeadId(randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)) {
  const suffix = randomUUID ? randomUUID().slice(0, 8).toUpperCase() : Math.random().toString(36).slice(2, 10).toUpperCase();
  return `AX-${suffix}`;
}
export function isLeadRecord(value, validStages) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = ["id","name","company","email","phone","segment","source","campaign","pain","urgency","stage","nextAction","nextActionDate","notes","createdAt","updatedAt"];
  return fields.every(k => typeof value[k] === "string")
    && typeof value.decisionMaker === "boolean"
    && typeof value.estimatedValue === "number" && Number.isFinite(value.estimatedValue)
    && value.estimatedValue >= 0 && validStages.includes(value.stage);
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
export function leadsToCsv(leads) {
  const headers = ["id","name","company","email","phone","segment","source","campaign","pain","urgency","decisionMaker","estimatedValue","stage","nextAction","nextActionDate","notes","createdAt","updatedAt"];
  const quote = value => {
    let text = String(value ?? "");
    if (/^[\s]*[=+@\-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g,'""')}"`;
  };
  return [headers.join(";"), ...leads.map(l => headers.map(k => quote(l[k])).join(";"))].join("\r\n");
}
