// Teste de fumaça dos diagnósticos no navegador (modo demonstração, arquivos FICTÍCIOS).
// Uso: npm run build && npm start   (em outro terminal)   e depois   npm run test:e2e:diag
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ecd, ecf, meses, trimestre } from "../tests/fixtures/sped.mjs";

const { chromium } = await import("playwright").catch(() => createRequire(import.meta.url)("playwright"));
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR ?? "";
const dir = mkdtempSync(join(tmpdir(), "axbi-diag-"));
const q = [trimestre(), trimestre(1.2), trimestre(0.8), trimestre()];
const m = meses(); m[4] = { ...m[4], receita: m[4].receita - 100000 }; // ECD com R$ 1.000,00 a menos
const files = {
  "ECF-2023.txt": ecf(2023, q),
  "ECF-2024.txt": ecf(2024, q.map(t => ({ ...t, rb: Math.round(t.rb * 0.7), pc: 60000000 }))),
  "ECD-2023.txt": ecd(2023, m, { ativo: 80000000, ac: 50000000, pc: 25000000, pl: 40000000 }),
  "nao-e-sped.txt": "arquivo qualquer\n"
};
// O SPED é ISO-8859-1: grava assim para exercitar a detecção de codificação.
const paths = Object.entries(files).map(([name, text]) => { const p = join(dir, name); writeFileSync(p, Buffer.from(text, "latin1")); return p; });

const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(BASE);
  await page.getByRole("button", { name: "Diagnósticos" }).click();
  await page.getByText("Nenhum diagnóstico ainda.").waitFor();
  await page.locator('input[type="file"]').setInputFiles(paths);

  // Prévia: arquivo inválido é recusado; os demais viram diagnóstico em rascunho.
  await page.getByText("conferir antes de salvar").waitFor();
  await page.getByText("1 arquivo(s) não foram aceitos").waitFor();
  await page.getByText("RASCUNHO").first().waitFor();
  const kpi = label => page.locator(".kpi", { hasText: label }).locator("strong").innerText();
  assert.match(await kpi("VARIAÇÃO DA RECEITA"), /-31,6%/);
  assert.match(await kpi("LIQUIDEZ CORRENTE"), /0,83/);
  await page.getByText("EMPRESA FICTICIA DE TESTES LTDA").first().waitFor();
  assert.ok(await page.locator("tr", { hasText: "Receita bruta 2023" }).filter({ hasText: "1.000,00" }).count(), "divergência ECD × ECF apontada");
  assert.ok(await page.locator("tr", { hasText: "Liquidez 2024" }).count(), "achado de liquidez");
  assert.ok(await page.locator("tr", { hasText: "ECD de 2024 não recebida" }).count(), "documento faltante apontado");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "diag-previa.png"), fullPage: true });

  await page.getByRole("button", { name: "Salvar como rascunho" }).click();
  await page.getByRole("button", { name: "Enviar para revisão" }).waitFor();

  // Planilha
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Planilha (.xlsx)" }).click()]);
  assert.match(dl.suggestedFilename(), /^diagnostico-11222333000181-2023-2024\.xlsx$/);
  const xlsx = readFileSync(await dl.path());
  assert.equal(xlsx.subarray(0, 2).toString(), "PK");
  assert.ok(xlsx.includes(Buffer.from("xl/worksheets/sheet13.xml")), "13 abas");
  if (SHOTS) writeFileSync(join(SHOTS, "diag-exemplo.xlsx"), xlsx);

  // Fluxo: rascunho -> em revisão -> aprovado; depois de aprovado não há mais botões de alteração.
  await page.getByRole("button", { name: "Enviar para revisão" }).click();
  await page.getByRole("button", { name: "Aprovar" }).click();
  await page.locator(".pill", { hasText: "Aprovado" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Voltar para rascunho" }).count(), 0);
  assert.equal(await page.getByText("RASCUNHO —").count(), 0, "relatório aprovado sai sem a tarja de rascunho");
  if (SHOTS) {
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: join(SHOTS, "diag-relatorio.pdf"), format: "A4", landscape: true, printBackground: true });
    await page.emulateMedia({ media: "screen" });
  }
  await page.getByRole("button", { name: "Voltar" }).click();
  assert.equal(await page.locator("tbody tr").count(), 1);
  assert.deepEqual(errors, []);
  console.log("E2E de diagnósticos: OK");
} finally {
  await browser.close();
}
