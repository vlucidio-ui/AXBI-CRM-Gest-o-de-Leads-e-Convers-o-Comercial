import type { ParsedSped } from "./sped.mjs";
export type Cents = number | null;
export type Semaforo = "verde" | "amarelo" | "vermelho" | null;
export type YearValues = Record<number, Cents>;
export type Indicator = {
  chave: string; nome: string; formula: string; fonte: string; tipo: "indice" | "moeda" | "percentual";
  melhor: "maior" | "menor" | null; verde: number | null; amarelo: number | null;
  valores: Record<number, { valor: number | null; semaforo: Semaforo }>;
};
export type Finding = { id: string; prioridade: "Alta" | "Média" | "Baixa"; area: string; achado: string; impacto: string; acao: string; situacao: string };
export type Diagnostic = {
  versao: string; geradoEm: string; empresa: { cnpj: string; nome: string }; anos: number[]; regime: string;
  resumo: null | {
    ano: number; receitaLiquida: Cents; lucroLiquido: Cents; varReceita: number | null; margemLiquida: number | null;
    liquidezCorrente: number | null; achadosAltos: number; divergencias: number; conciliados: number;
  };
  fontes: { arquivo: string; tipo: string; ano: number; periodo: string; cnpj: string; sha256: string; bytes: number | null; linhas: number; registros: Record<string, number>; usado: boolean; retificadora: string; avisos: string[] }[];
  dreAnual: { chave: string; rotulo: string; valores: YearValues }[];
  dreTrimestral: ({ ano: number; tri: number; dataBase: string; linha: number } & Record<string, Cents | string>)[];
  bpAnual: { chave: string; rotulo: string; valores: YearValues }[];
  bpTrimestral: ({ ano: number; tri: number; dataBase: string; linha: number } & Record<string, Cents | string>)[];
  bpDetalhe: { codigo: string; rubrica: string; nivel: number; valores: YearValues }[];
  indicadores: Indicator[];
  conciliacao: { ano: number; rubrica: string; ecd: Cents; ecf: Cents; diferenca: Cents; situacao: string; fonteEcd: string; fonteEcf: string }[];
  controles: { ano: number; ativoMenosPassivo: Cents; receitaLiquida: Cents; lucroLiquido: Cents }[];
  lucroMensal: { ano: number; mes: number; periodo: string; lucro: number; encerramento: boolean; metodo: string; linha: number }[];
  trilha: null | { ano: number; dre: { rubrica: string; value: Cents; line: number | null; how: string }[]; bp: { rubrica: string; value: Cents; line: number | null; how: string }[] };
  achados: Finding[];
  planoAcao: { ordem: number; prazo: string; prioridade: string; atividade: string; origem: string; area: string; status: string }[];
  metodologia: { indicador: string; formula: string; fonte: string; validacao: string }[];
  limites: string[];
};
export const ENGINE_VERSION: string;
export const TOLERANCE_CENTS: number;
export function brl(cents: Cents | undefined): string;
export function trafficLight(def: { melhor: string | null; verde?: number; amarelo?: number }, value: number | null | undefined): Semaforo;
export function buildDiagnostic(files: ParsedSped[], options?: { now?: Date }): Diagnostic;
