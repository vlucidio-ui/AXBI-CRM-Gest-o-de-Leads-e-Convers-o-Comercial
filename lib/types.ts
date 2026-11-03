export type Stage =
  | "Novo lead" | "Em qualificação" | "Qualificado"
  | "Diagnóstico agendado" | "Diagnóstico realizado"
  | "Proposta enviada" | "Negociação" | "Fechado" | "Perdido" | "Nutrição";

export const stages: Stage[] = [
  "Novo lead", "Em qualificação", "Qualificado", "Diagnóstico agendado",
  "Diagnóstico realizado", "Proposta enviada", "Negociação", "Fechado", "Perdido", "Nutrição"
];

export type Lead = {
  id: string; name: string; company: string; email: string; phone: string;
  segment: string; source: string; campaign: string; pain: string;
  urgency: "Imediata" | "Até 30 dias" | "Até 90 dias" | "Sem prazo";
  decisionMaker: boolean; estimatedValue: number; stage: Stage;
  nextAction: string; nextActionDate: string; notes: string;
  createdAt: string; updatedAt: string;
};

export const money = (value: number) => new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL", maximumFractionDigits: 0
}).format(value || 0);
