export type Stage =
  | "Novo lead" | "Em qualificação" | "Qualificado"
  | "Diagnóstico agendado" | "Diagnóstico realizado"
  | "Proposta enviada" | "Negociação" | "Fechado" | "Perdido" | "Nutrição";

export const stages: Stage[] = [
  "Novo lead", "Em qualificação", "Qualificado", "Diagnóstico agendado",
  "Diagnóstico realizado", "Proposta enviada", "Negociação", "Fechado", "Perdido", "Nutrição"
];

export type Urgency = "Imediata" | "Até 30 dias" | "Até 90 dias" | "Sem prazo";
export const urgencies: Urgency[] = ["Imediata", "Até 30 dias", "Até 90 dias", "Sem prazo"];

export type Lead = {
  id: string; name: string; company: string; email: string; phone: string;
  segment: string; source: string; campaign: string; pain: string;
  urgency: Urgency;
  decisionMaker: boolean; estimatedValue: number; stage: Stage;
  nextAction: string; nextActionDate: string; notes: string;
  createdAt: string; updatedAt: string;
};

export type Role = "owner" | "admin" | "member" | "viewer";

export type Organization = { id: string; name: string; slug: string; role: Role; publicFormEnabled: boolean };

export const roleLabels: Record<Role, string> = {
  owner: "Proprietário", admin: "Administrador", member: "Vendedor", viewer: "Somente leitura"
};

export const money = (value: number) => new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL", maximumFractionDigits: 0
}).format(value || 0);

export const formatDate = (iso: string) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};
