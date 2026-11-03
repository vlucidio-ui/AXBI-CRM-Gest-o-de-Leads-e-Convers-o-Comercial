import type { Lead, Stage } from "./types";
export function localDate(date?: Date): string;
export function createLeadId(randomUUID?: (() => string) | undefined): string;
export function isLeadRecord(value: unknown, validStages: Stage[]): value is Lead;
export function calculateMetrics(leads: Lead[]): { total: number; active: number; qualified: number; won: number; contracted: number; proposalValue: number; closeRate: number };
export function filterLeads(leads: Lead[], query?: string, stage?: string): Lead[];
export function leadsToCsv(leads: Lead[]): string;
