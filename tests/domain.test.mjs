import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STAGES, calculateMetrics, createLeadId, emptyLead, filterLeads, followUps, isLeadRecord,
  leadToRow, leadsToCsv, localDate, rowToLead, sourceBreakdown, validateLead
} from "../lib/domain.mjs";

const lead = (over = {}) => ({ ...emptyLead(new Date("2026-11-01T12:00:00Z")), id: createLeadId(), name: "Ana", ...over });

test("localDate usa o fuso local no formato AAAA-MM-DD", () => {
  assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("createLeadId gera UUID v4 válido, com e sem crypto", () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(createLeadId(), uuid);
  assert.match(createLeadId(null), uuid);
  assert.notEqual(createLeadId(null), createLeadId(null));
});

test("isLeadRecord aceita lead válido e rejeita estruturas inválidas", () => {
  assert.equal(isLeadRecord(lead(), STAGES), true);
  assert.equal(isLeadRecord(null), false);
  assert.equal(isLeadRecord([]), false);
  assert.equal(isLeadRecord({ ...lead(), stage: "Inexistente" }), false);
  assert.equal(isLeadRecord({ ...lead(), urgency: "Ontem" }), false);
  assert.equal(isLeadRecord({ ...lead(), estimatedValue: -1 }), false);
  assert.equal(isLeadRecord({ ...lead(), estimatedValue: NaN }), false);
  assert.equal(isLeadRecord({ ...lead(), decisionMaker: "sim" }), false);
});

test("validateLead aponta campos obrigatórios e formatos", () => {
  assert.deepEqual(validateLead(lead()), []);
  assert.ok(validateLead(lead({ name: "  " })).length);
  assert.ok(validateLead(lead({ email: "sem-arroba" })).length);
  assert.ok(validateLead(lead({ estimatedValue: -5 })).length);
  assert.ok(validateLead(lead({ nextActionDate: "01/02/2026" })).length);
});

test("calculateMetrics segue as definições do README", () => {
  const leads = [
    lead({ stage: "Novo lead", estimatedValue: 100 }),
    lead({ stage: "Qualificado", estimatedValue: 200 }),
    lead({ stage: "Proposta enviada", estimatedValue: 1000 }),
    lead({ stage: "Negociação", estimatedValue: 2000 }),
    lead({ stage: "Fechado", estimatedValue: 5000 }),
    lead({ stage: "Perdido", estimatedValue: 700 }),
    lead({ stage: "Nutrição", estimatedValue: 50 })
  ];
  assert.deepEqual(calculateMetrics(leads), {
    total: 7, active: 5, qualified: 4, won: 1, contracted: 5000, proposalValue: 3000, closeRate: 25
  });
  assert.equal(calculateMetrics([]).closeRate, 0);
});

test("filterLeads busca sem diferenciar maiúsculas e filtra por etapa", () => {
  const leads = [lead({ name: "João", company: "Padaria Pão" }), lead({ name: "Maria", campaign: "Black Friday", stage: "Fechado" })];
  assert.equal(filterLeads(leads, "PADARIA").length, 1);
  assert.equal(filterLeads(leads, "black").length, 1);
  assert.equal(filterLeads(leads, "", "Fechado").length, 1);
  assert.equal(filterLeads(leads, "joão", "Fechado").length, 0);
  assert.equal(filterLeads(leads).length, 2);
});

test("followUps ignora fechados, ordena por data e marca atrasados", () => {
  const leads = [
    lead({ name: "B", nextActionDate: "2026-11-10" }),
    lead({ name: "A", nextActionDate: "2026-11-01" }),
    lead({ name: "C", nextActionDate: "2026-11-05" }),
    lead({ name: "X", nextActionDate: "2026-10-01", stage: "Fechado" }),
    lead({ name: "Y", nextActionDate: "" })
  ];
  const result = followUps(leads, "2026-11-05");
  assert.deepEqual(result.map(r => r.lead.name), ["A", "C", "B"]);
  assert.deepEqual(result.map(r => [r.overdue, r.isToday]), [[true, false], [false, true], [false, false]]);
});

test("sourceBreakdown agrupa por canal", () => {
  const rows = sourceBreakdown([
    lead({ source: "Instagram", stage: "Fechado", estimatedValue: 300 }),
    lead({ source: "Instagram" }),
    lead({ source: "" })
  ]);
  assert.deepEqual(rows, [
    { source: "Instagram", total: 2, won: 1, contracted: 300 },
    { source: "Não informado", total: 1, won: 0, contracted: 0 }
  ]);
});

test("leadsToCsv usa ; , escapa aspas e neutraliza fórmulas", () => {
  const csv = leadsToCsv([lead({ name: '=HYPERLINK("x")', company: 'Empresa "A"', notes: " +1", phone: "-5", email: "@x" })]);
  const [header, row] = csv.split("\r\n");
  assert.ok(header.startsWith("id;name;company"));
  assert.ok(row.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(row.includes(`"Empresa ""A"""`));
  assert.ok(row.includes(`"' +1"`));
  assert.ok(row.includes(`"'-5"`));
  assert.ok(row.includes(`"'@x"`));
});

test("leadToRow e rowToLead fazem ida e volta", () => {
  const original = lead({ email: " Ana@X.com ", nextActionDate: "2026-11-20", decisionMaker: true, estimatedValue: 1234.5 });
  const row = leadToRow(original, "org-1");
  assert.equal(row.organization_id, "org-1");
  assert.equal(row.email, "ana@x.com");
  assert.equal(leadToRow(lead({ nextActionDate: "" }), "o").next_action_date, null);
  const back = rowToLead({ ...row, estimated_value: "1234.50", created_at: original.createdAt, updated_at: original.updatedAt });
  assert.deepEqual(back, { ...original, email: "ana@x.com" });
});
