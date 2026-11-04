// Teste de fumaça no navegador (modo local, sem Supabase).
// Uso: npm run build && npm start   (em outro terminal)   e depois   npm run test:e2e
// Requer o pacote "playwright" disponível (npm i -D playwright && npx playwright install chromium).
import { createRequire } from "node:module";
import assert from "node:assert/strict";

// import dinâmico com fallback para instalação global (NODE_PATH)
const { chromium } = await import("playwright").catch(() => createRequire(import.meta.url)("playwright"));
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(BASE);
  await page.getByText("Modo demonstração").waitFor();

  // Cadastro
  await page.getByRole("button", { name: "Novo lead" }).first().click();
  await page.getByLabel("Contato *").fill("Maria Teste");
  await page.getByLabel("Empresa", { exact: true }).fill("Padaria Central");
  await page.getByLabel("Canal de origem").fill("Instagram");
  await page.getByLabel("Valor potencial (R$)").fill("5000");
  await page.getByLabel("Etapa").selectOption("Proposta enviada");
  await page.getByLabel("Próxima ação", { exact: true }).fill("Ligar");
  await page.getByLabel("Data da próxima ação").fill("2020-01-01");
  await page.getByRole("button", { name: "Salvar" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });

  // Painel
  const kpi = label => page.locator(".kpi", { hasText: label }).locator("strong").innerText();
  assert.equal(await kpi("Leads cadastrados"), "1");
  assert.match(await kpi("Pipeline em negociação"), /5\.000/);
  assert.equal(await kpi("Follow-ups atrasados"), "1");

  // Pipeline: mover para Fechado
  await page.getByRole("button", { name: "Pipeline" }).click();
  await page.getByLabel("Mover Maria Teste").selectOption("Fechado");
  await page.getByRole("button", { name: "Painel" }).click();
  assert.match(await kpi("Receita contratada"), /5\.000/);
  assert.equal(await kpi("Taxa de fechamento"), "100%");

  // Persistência após recarregar
  await page.reload();
  assert.equal(await kpi("Leads cadastrados"), "1");

  // Busca e exportação
  await page.getByRole("button", { name: "Leads" }).click();
  await page.getByPlaceholder(/Buscar/).fill("padaria");
  assert.equal(await page.locator("tbody tr").count(), 1);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportar CSV" }).click()]);
  assert.match(download.suggestedFilename(), /^leads-\d{4}-\d{2}-\d{2}\.csv$/);

  // Origens
  await page.getByRole("button", { name: "Origens" }).click();
  await page.getByRole("cell", { name: "Instagram" }).waitFor();

  // Exclusão
  await page.getByRole("button", { name: "Leads" }).click();
  await page.getByPlaceholder(/Buscar/).fill("");
  page.once("dialog", d => d.accept());
  await page.getByLabel("Excluir Maria Teste").click();
  await page.getByText("Nenhum lead encontrado.").waitFor();

  // Celular: sem rolagem horizontal da página
  await page.setViewportSize({ width: 375, height: 800 });
  await page.getByRole("button", { name: "Painel" }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `rolagem horizontal de ${overflow}px no celular`);

  assert.deepEqual(errors, [], "erros de JavaScript na página");
  console.log("E2E OK: cadastro, painel, pipeline, persistência, busca, CSV, origens, exclusão e layout celular.");
} finally {
  await browser.close();
}
