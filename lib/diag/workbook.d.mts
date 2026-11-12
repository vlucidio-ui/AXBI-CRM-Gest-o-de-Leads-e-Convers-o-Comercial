import type { Diagnostic } from "./engine.mjs";
export function formatCnpj(cnpj: string | null | undefined): string;
export function diagnosticSheets(d: Diagnostic): { name: string; rows: unknown[][] }[];
export function diagnosticXlsx(d: Diagnostic): Uint8Array;
