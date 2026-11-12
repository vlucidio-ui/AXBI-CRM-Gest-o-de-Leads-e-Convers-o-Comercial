// Leitura dos arquivos no navegador: o conteúdo NÃO é enviado a servidor algum.
import { parseSped, type ParsedSped } from "./sped.mjs";

export const MAX_FILE_BYTES = 300 * 1024 * 1024;

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");

/** SPED costuma vir em ISO-8859-1; arquivos em UTF-8 também são aceitos. */
export function decodeSped(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export async function readSpedFile(file: File): Promise<ParsedSped> {
  if (file.size === 0) return { ok: false, fileName: file.name, error: "Arquivo vazio." };
  if (file.size > MAX_FILE_BYTES) return { ok: false, fileName: file.name, error: "Arquivo acima de 300 MB." };
  const bytes = await file.arrayBuffer();
  const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  const parsed = parseSped(decodeSped(bytes), file.name);
  return { ...parsed, sha256, bytes: file.size };
}
