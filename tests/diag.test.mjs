// Motor de diagnóstico (AXBI-DIAG-CORE): leitura de ECF/ECD e cálculos determinísticos.
// Todos os arquivos são fictícios (tests/fixtures/sped.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCents, parseDate, parseSped } from "../lib/diag/sped.mjs";
import { buildDiagnostic, trafficLight, ENGINE_VERSION } from "../lib/diag/engine.mjs";
import { CNPJ, ecd, ecf, meses, trimestre } from "./fixtures/sped.mjs";

const NOW = new Date("2026-11-12T12:00:00Z");
const ler = (texto, nome) => parseSped(texto, nome);
const linha = (d, chave, ano) => d.dreAnual.find(r => r.chave === chave).valores[ano];
const bp = (d, chave, ano) => d.bpAnual.find(r => r.chave === chave).valores[ano];
const ind = (d, chave, ano) => d.indicadores.find(i => i.chave === chave).valores[ano];

test("parseCents converte para centavos sem ponto flutuante", () => {
  assert.equal(parseCents("1234,56"), 123456);
  assert.equal(parseCents("1.234,56"), 123456);
  assert.equal(parseCents("0,1"), 10);
  assert.equal(parseCents("14532844,18"), 1453284418);
  assert.equal(parseCents(""), 0);
  assert.equal(parseCents("12,5x"), null);
  assert.equal(parseCents("=1+1"), null);
});

test("parseDate aceita DDMMAAAA e rejeita o resto", () => {
  assert.equal(parseDate("31122025"), "2025-12-31");
  assert.equal(parseDate("20251231"), "");
  assert.equal(parseDate("3112"), "");
});

test("arquivo que não é ECF nem ECD é recusado com mensagem clara", () => {
  const r = ler("|0000|EFD|qualquer|\n", "x.txt");
  assert.equal(r.ok, false);
  assert.match(r.error, /não reconhecido/);
  assert.equal(ler("texto solto", "y.txt").ok, false);
});

test("ECF: identifica empresa, período, trimestres e sinais", () => {
  const f = ler(ecf(2024, [trimestre(), trimestre(), trimestre(), trimestre()]), "ecf2024.txt");
  assert.equal(f.ok, true);
  assert.equal(f.type, "ECF");
  assert.equal(f.cnpj, CNPJ);
  assert.equal(f.year, 2024);
  assert.equal(f.retificadora, "N");
  assert.equal(f.periods.length, 4);
  assert.equal(f.counts.P150, 40);
  const t1 = f.periods[0];
  assert.equal(t1.code, "T01");
  assert.equal(t1.dre.find(r => r.code === "3.01.01.01.01").value, 30000000);
  assert.equal(t1.dre.find(r => r.code === "3.01.01.01.02").value, -1500000, "dedução é devedora: negativa");
  assert.equal(t1.bp.find(r => r.code === "1").value, 80000000);
  assert.equal(t1.bp.find(r => r.code === "2.03").value, 40000000);
  assert.ok(t1.dre[0].line > 1, "cada registro guarda a linha de origem");
});

test("ECD: plano de contas, saldos mensais, encerramento, J100 e J150", () => {
  const f = ler(ecd(2024, meses(), { ativo: 80000000, ac: 50000000, pc: 25000000, pl: 40000000 }), "ecd2024.txt");
  assert.equal(f.type, "ECD");
  assert.equal(f.cnpj, CNPJ);
  assert.equal(f.layout, "9.00");
  assert.equal(f.months.length, 12);
  assert.equal(f.closings.length, 1);
  assert.equal(f.accounts["3101"].nature, "04");
  assert.equal(f.j100.find(r => r.name === "ATIVO").value, 80000000);
  assert.equal(f.j100.find(r => r.name === "PATRIMONIO LIQUIDO").value, 40000000);
  assert.equal(f.j150.find(r => r.name === "RECEITA BRUTA").value, 120000000);
  assert.equal(f.j150.find(r => r.name.startsWith("DEDUCOES")).value, -6000000);
});

test("diagnóstico: DRE anual é a soma dos trimestres e os controles fecham", () => {
  const d = buildDiagnostic([ler(ecf(2024, [trimestre(), trimestre(1.2), trimestre(0.8), trimestre()]), "ecf.txt")], { now: NOW });
  assert.equal(d.versao, ENGINE_VERSION);
  assert.deepEqual(d.anos, [2024]);
  assert.equal(linha(d, "rb", 2024), 120000000);
  assert.equal(linha(d, "ded", 2024), -6000000);
  assert.equal(linha(d, "rl", 2024), 114000000);
  assert.equal(linha(d, "lb", 2024), 114000000 - 36000000);
  assert.equal(linha(d, "ll", 2024), 114000000 - 36000000 + 1200000 - 24000000 - 8000000);
  assert.equal(d.dreTrimestral.length, 4);
  assert.deepEqual(d.controles[0], { ano: 2024, ativoMenosPassivo: 0, receitaLiquida: 0, lucroLiquido: 0 });
  assert.equal(bp(d, "ativo", 2024), 80000000);
  assert.equal(d.resumo.ano, 2024);
  assert.equal(d.empresa.cnpj, CNPJ);
});

test("indicadores e semáforos seguem as fórmulas documentadas", () => {
  const d = buildDiagnostic([ler(ecf(2024, [trimestre(), trimestre(), trimestre(), trimestre()]), "ecf.txt")], { now: NOW });
  assert.equal(ind(d, "liquidezCorrente", 2024).valor, 2);
  assert.equal(ind(d, "liquidezCorrente", 2024).semaforo, "verde");
  assert.equal(ind(d, "liquidezSeca", 2024).valor, 1.8);
  assert.equal(ind(d, "liquidezImediata", 2024).valor, 0.8);
  assert.equal(ind(d, "capitalGiro", 2024).valor, 25000000);
  assert.equal(ind(d, "endividamento", 2024).valor, 0.5);
  assert.equal(ind(d, "terceirosPl", 2024).valor, 1);
  assert.equal(ind(d, "margemBruta", 2024).valor, Math.round((78000000 / 114000000) * 1e6) / 1e6);
  assert.equal(ind(d, "roa", 2024).valor, null, "ROA exige o ano anterior: não é estimado");
  assert.equal(ind(d, "varReceita", 2024).valor, null);
  assert.equal(trafficLight({ melhor: "maior", verde: 1.2, amarelo: 1 }, 1.1), "amarelo");
  assert.equal(trafficLight({ melhor: "maior", verde: 1.2, amarelo: 1 }, 0.9), "vermelho");
  assert.equal(trafficLight({ melhor: "menor", verde: 0.5, amarelo: 0.7 }, 0.6), "amarelo");
  assert.equal(trafficLight({ melhor: "maior", verde: 0, amarelo: 0 }, -1), "vermelho");
  assert.equal(trafficLight({ melhor: "maior", verde: 1, amarelo: 0.5 }, null), null);
});

test("conciliação ECD × ECF: coincidências viram Conciliado, diferenças viram achado de prioridade alta", () => {
  const q = [trimestre(), trimestre(), trimestre(), trimestre()];
  const bal = { ativo: 80000000, ac: 50000000, pc: 25000000, pl: 40000000 };
  const ok = buildDiagnostic([ler(ecf(2024, q), "ecf.txt"), ler(ecd(2024, meses(), bal), "ecd.txt")], { now: NOW });
  const sit = (d, rubrica) => d.conciliacao.find(c => c.rubrica === rubrica);
  assert.equal(sit(ok, "Receita bruta").situacao, "Conciliado");
  assert.equal(sit(ok, "Deduções da receita").situacao, "Conciliado");
  assert.equal(sit(ok, "Ativo total").situacao, "Conciliado");

  // ECD com R$ 1.000,00 a menos de receita em um mês e ativo R$ 2.523,35 maior.
  const m = meses(); m[4] = { ...m[4], receita: m[4].receita - 100000 };
  const dif = buildDiagnostic([ler(ecf(2024, q), "ecf.txt"), ler(ecd(2024, m, { ...bal, ativo: bal.ativo + 252335 }), "ecd.txt")], { now: NOW });
  assert.equal(sit(dif, "Receita bruta").situacao, "Divergência");
  assert.equal(sit(dif, "Receita bruta").diferenca, 100000);
  assert.equal(sit(dif, "Ativo total").diferenca, -252335);
  const achado = dif.achados.find(a => a.area === "Receita bruta 2024");
  assert.equal(achado.prioridade, "Alta");
  assert.match(achado.achado, /R\$ 1\.000,00/);
  assert.ok(dif.planoAcao.some(p => p.origem === achado.id && p.prazo === "Imediato"));
});

test("lucro mensal da ECD: soma do ano é igual ao encerramento (I355)", () => {
  const d = buildDiagnostic([ler(ecd(2024, meses(), { ativo: 1, ac: 1, pc: 1, pl: 1 }), "ecd.txt")], { now: NOW });
  assert.equal(d.lucroMensal.length, 12);
  const cada = 10000000 - 500000 - 5566667;
  assert.equal(d.lucroMensal[0].lucro, cada);
  assert.equal(d.lucroMensal[11].encerramento, true);
  assert.equal(d.lucroMensal[11].lucro, cada, "o zeramento das contas não distorce o último mês");
  assert.equal(d.lucroMensal.reduce((s, x) => s + x.lucro, 0), cada * 12);
});

test("regras de risco: queda de receita com alta de custos, liquidez, prejuízo e balanço que não fecha", () => {
  const bom = [trimestre(), trimestre(), trimestre(), trimestre()];
  const ruim = Array.from({ length: 4 }, () => trimestre(0.6, { custos: 15000000, ac: 20000000, disp: 2000000, estoques: 0, pc: 30000000, anc: 60000000, pnc: 15000000, pl: 35000000 }));
  const d = buildDiagnostic([ler(ecf(2023, bom), "a.txt"), ler(ecf(2024, ruim, { ativoErrado: 500 }), "b.txt")], { now: NOW });
  const areas = d.achados.map(a => a.area);
  assert.ok(areas.includes("Receita 2024"));
  assert.ok(areas.includes("Margem e custos 2024"));
  assert.ok(areas.includes("Liquidez 2024"));
  assert.ok(areas.includes("Resultado 2024"));
  assert.ok(areas.includes("Balanço 2024"));
  assert.equal(ind(d, "varReceita", 2024).valor, -0.4);
  assert.equal(ind(d, "liquidezCorrente", 2024).semaforo, "vermelho");
  assert.notEqual(ind(d, "roa", 2024).valor, null, "com o ano anterior o ROA é calculado sobre o ativo médio");
  assert.deepEqual(d.achados.map(a => a.id), d.achados.map((_, i) => "R" + String(i + 1).padStart(2, "0")));
  const prioridades = d.achados.map(a => a.prioridade);
  assert.deepEqual(prioridades, [...prioridades].sort((a, b) => "AMB".indexOf(a[0]) - "AMB".indexOf(b[0])), "achados ordenados por prioridade");
});

test("documentos: retificadora prevalece, CNPJs misturados e anos faltantes são apontados", () => {
  const q = [trimestre(), trimestre(), trimestre(), trimestre()];
  const original = ler(ecf(2024, q), "original.txt");
  const retif = ler(ecf(2024, q.map(t => ({ ...t, rb: t.rb + 100 })), { retificadora: "S" }), "retificadora.txt");
  const d = buildDiagnostic([retif, original, ler(ecf(2022, q, { cnpj: "99888777000166" }), "outra.txt")], { now: NOW });
  assert.equal(linha(d, "rb", 2024), 120000400, "usa a retificadora mesmo enviada antes da original");
  assert.equal(d.fontes.find(f => f.arquivo === "original.txt").usado, false);
  assert.ok(d.achados.some(a => /CNPJs diferentes/.test(a.achado)));
  assert.ok(d.achados.some(a => /mais de uma ECF de 2024/.test(a.achado)));
  assert.ok(d.achados.some(a => /ECD de 2024 não recebida/.test(a.achado)));
  assert.ok(d.achados.some(a => /Não há arquivos de 2023/.test(a.achado)));
});

test("rubrica ausente fica n/d e é apontada, nunca vira zero", () => {
  const texto = ecf(2024, [trimestre(), trimestre(), trimestre(), trimestre()]).split("\r\n").filter(l => !l.includes("|3.02|")).join("\r\n");
  const d = buildDiagnostic([ler(texto, "sem-provisao.txt")], { now: NOW });
  assert.equal(linha(d, "prov", 2024), null);
  assert.equal(ind(d, "cargaTributaria", 2024).valor, null);
  assert.equal(d.controles[0].lucroLiquido, null);
});

test("mesma entrada gera exatamente a mesma saída (determinismo) e sem arquivos não inventa nada", () => {
  const arquivos = () => [ler(ecf(2024, [trimestre(), trimestre(), trimestre(), trimestre()]), "ecf.txt"), ler(ecd(2024, meses(), { ativo: 80000000, ac: 50000000, pc: 25000000, pl: 40000000 }), "ecd.txt")];
  assert.equal(JSON.stringify(buildDiagnostic(arquivos(), { now: NOW })), JSON.stringify(buildDiagnostic(arquivos(), { now: NOW })));
  const vazio = buildDiagnostic([{ ok: false, error: "x" }], { now: NOW });
  assert.deepEqual(vazio.anos, []);
  assert.equal(vazio.resumo, null);
  assert.equal(vazio.dreTrimestral.length, 0);
});
