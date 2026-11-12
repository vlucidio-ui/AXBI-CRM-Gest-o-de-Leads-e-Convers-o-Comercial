export function zipStore(entries: { name: string; data: Uint8Array }[]): Uint8Array;
export function buildXlsx(sheets: { name: string; cols?: number[]; freeze?: number; rows: unknown[][] }[]): Uint8Array;
