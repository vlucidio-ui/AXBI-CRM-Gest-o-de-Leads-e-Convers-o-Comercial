export type ParsedSped = {
  ok: boolean; type?: "ECF" | "ECD"; fileName: string; error?: string; cnpj?: string; name?: string; year?: number;
  dtIni?: string; dtFin?: string; lineCount?: number; counts?: Record<string, number>; warnings?: string[];
  sha256?: string; bytes?: number; [key: string]: unknown;
};
export function parseCents(raw: unknown): number | null;
export function parseDate(raw: unknown): string;
export function parseSped(text: string, fileName?: string): ParsedSped;
