// Planilha dos demonstrativos: transforma o diagnóstico (engine.mjs) nas abas do arquivo .xlsx.
import { buildXlsx } from "./xlsx.mjs";

const M = cents => cents === null || cents === undefined ? "n/d" : { v: cents / 100, s: "money" };
const P = v => v === null || v === undefined ? "n/d" : { v, s: "percent" };
const R = v => v === null || v === undefined ? "n/d" : { v, s: "ratio" };
const H = (...labels) => labels.map(v => ({ v, s: "header" }));
const W = v => ({ v, s: "wrap" });
const head = (title, note) => [[{ v: title, s: "title" }], [{ v: note, s: "note" }], []];
const SEM = { verde: "Verde", amarelo: "Amarelo", vermelho: "Vermelho" };
export const formatCnpj = c => /^\d{14}$/.test(c ?? "") ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : (c ?? "");
const indValue = (i, x) => i.tipo === "moeda" ? M(x.valor) : i.tipo === "percentual" ? P(x.valor) : R(x.valor);

export function diagnosticSheets(d) {
  const anos = d.anos, r = d.resumo;
  const empresa = `${d.empresa.nome || "Empresa"} · CNPJ ${formatCnpj(d.empresa.cnpj) || "n/d"}`;
  const sheets = [];

  sheets.push({
    name: "01_Executivo", cols: [38, 22, 22, 60],
    rows: [
      ...head("DIAGNÓSTICO EXECUTIVO", `${empresa} · exercícios ${anos.join(", ") || "n/d"} · gerado em ${d.geradoEm.slice(0, 10)} · ${d.versao}`),
      H("Indicador", r ? String(r.ano) : "—", "Situação", "Leitura"),
      ["Receita líquida", M(r?.receitaLiquida), "", "DRE da ECF, soma dos períodos do ano"],
      ["Lucro líquido", M(r?.lucroLiquido), "", "DRE da ECF"],
      ["Variação da receita líquida", P(r?.varReceita), "", "Sobre o ano anterior, quando enviado"],
      ["Margem líquida", P(r?.margemLiquida), "", "Lucro líquido ÷ receita líquida"],
      ["Liquidez corrente", R(r?.liquidezCorrente), "", "Ativo circulante ÷ passivo circulante"],
      ["Achados de prioridade alta", r?.achadosAltos ?? 0, "", "Ver aba 08_Riscos"],
      ["Rubricas conciliadas ECD × ECF", r?.conciliados ?? 0, "", "Diferença de até R$ 0,01"],
      ["Rubricas divergentes ECD × ECF", r?.divergencias ?? 0, "", "Ver aba 07_Conciliacao"],
      [],
      ...d.limites.map(l => [{ v: l, s: "note" }])
    ]
  });

  sheets.push({
    name: "02_DRE_Anual", cols: [42, ...anos.map(() => 20)], freeze: 4,
    rows: [...head("DRE ANUAL", "Soma dos períodos de apuração da ECF. Custos, deduções e despesas aparecem negativos."),
      H("Rubrica", ...anos.map(String)),
      ...d.dreAnual.map(l => [l.rotulo, ...anos.map(y => M(l.valores[y]))]),
      [],
      H("Controle (deve ser zero)", ...anos.map(String)),
      ["Receita bruta + deduções − receita líquida", ...anos.map(y => M(d.controles.find(c => c.ano === y)?.receitaLiquida ?? null))],
      ["Resultado antes dos tributos + provisão − lucro líquido", ...anos.map(y => M(d.controles.find(c => c.ano === y)?.lucroLiquido ?? null))]]
  });

  sheets.push({
    name: "03_DRE_Trimestral", cols: [8, 6, 13, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 10], freeze: 4,
    rows: [...head("DRE TRIMESTRAL", "Registros de DRE da ECF por período de apuração. A coluna “Linha” indica onde o período começa no arquivo."),
      H("Ano", "Tri", "Data-base", "Receita bruta", "Deduções", "Receita líquida", "Custos", "Lucro bruto", "Outras receitas", "Despesas oper.", "Resultado antes IR/CSLL", "Provisão IR/CSLL", "Lucro líquido", "Linha"),
      ...d.dreTrimestral.map(t => [t.ano, t.tri, t.dataBase, M(t.rb), M(t.ded), M(t.rl), M(t.custos), M(t.lb), M(t.outrasRec), M(t.despOp), M(t.resAntes), M(t.prov), M(t.ll), t.linha])]
  });

  sheets.push({
    name: "04_Balanco_Anual", cols: [38, ...anos.map(() => 20)], freeze: 4,
    rows: [...head("BALANÇO PATRIMONIAL — SALDOS DE FECHAMENTO", "Saldos finais do último período de apuração de cada ECF."),
      H("Grupo", ...anos.map(String)),
      ...d.bpAnual.map(l => [l.rotulo, ...anos.map(y => M(l.valores[y]))]),
      [],
      H("Controle (deve ser zero)", ...anos.map(String)),
      ["Ativo − (passivo + patrimônio líquido)", ...anos.map(y => M(d.controles.find(c => c.ano === y)?.ativoMenosPassivo ?? null))],
      [],
      H("Código referencial", ...anos.map(String)),
      ...d.bpDetalhe.map(l => [`${l.codigo}  ${"  ".repeat(Math.max(0, l.nivel - 1))}${l.rubrica}`, ...anos.map(y => M(l.valores[y]))])]
  });

  sheets.push({
    name: "05_Balanco_Trimestral", cols: [8, 6, 13, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18], freeze: 4,
    rows: [...head("BALANÇO PATRIMONIAL — POR TRIMESTRE", "Saldos finais de cada período de apuração da ECF."),
      H("Ano", "Tri", "Data-base", "Ativo total", "Ativo circulante", "Disponibilidades", "Créditos", "Estoques", "Ativo não circ.", "Passivo circulante", "Passivo não circ.", "Patrimônio líquido", "Passivo + PL"),
      ...d.bpTrimestral.map(t => [t.ano, t.tri, t.dataBase, M(t.ativo), M(t.ac), M(t.disp), M(t.cred), M(t.estoques), M(t.anc), M(t.pc), M(t.pnc), M(t.pl), M(t.passivoTotal)])]
  });

  sheets.push({
    name: "06_Indicadores", cols: [36, 52, ...anos.flatMap(() => [16, 11]), 14, 14], freeze: 4,
    rows: [...head("INDICADORES E SEMÁFOROS", "Faixas de referência AXBI (ponto de partida; variam por setor). n/d = dado não disponível nos arquivos."),
      H("Indicador", "Fórmula", ...anos.flatMap(y => [String(y), "Semáforo"]), "Verde", "Amarelo"),
      ...d.indicadores.map(i => [i.nome, W(i.formula), ...anos.flatMap(y => [indValue(i, i.valores[y]), SEM[i.valores[y].semaforo] ?? ""]),
        i.melhor ? `${i.melhor === "maior" ? "≥" : "≤"} ${i.verde}` : "", i.melhor && i.amarelo !== i.verde ? `${i.melhor === "maior" ? "≥" : "≤"} ${i.amarelo}` : ""])]
  });

  sheets.push({
    name: "07_Conciliacao", cols: [8, 26, 20, 20, 18, 18, 14, 22], freeze: 4,
    rows: [...head("CONCILIAÇÃO ECD × ECF", "Diferença = ECF − ECD. Conciliado quando a diferença é de até R$ 0,01."),
      H("Ano", "Rubrica", "ECD (R$)", "ECF (R$)", "Diferença (R$)", "Situação", "Fonte ECD", "Fonte ECF"),
      ...d.conciliacao.map(c => [c.ano, c.rubrica, M(c.ecd), M(c.ecf), M(c.diferenca), c.situacao, c.fonteEcd, c.fonteEcf])]
  });

  sheets.push({
    name: "08_Riscos", cols: [7, 11, 24, 70, 38, 52, 16], freeze: 4,
    rows: [...head("MATRIZ DE ACHADOS E RISCOS", "Gerada por regras fixas sobre os números acima. “Aplicado” = limite já respeitado no relatório."),
      H("ID", "Prioridade", "Área", "Achado / evidência", "Impacto potencial", "Ação recomendada", "Situação"),
      ...d.achados.map(a => [a.id, a.prioridade, a.area, W(a.achado), W(a.impacto), W(a.acao), a.situacao])]
  });

  sheets.push({
    name: "09_Plano_Acao", cols: [8, 14, 11, 60, 10, 26, 12], freeze: 4,
    rows: [...head("PLANO DE AÇÃO", "Uma ação por achado em aberto, na ordem de prioridade."),
      H("Ordem", "Prazo", "Prioridade", "Atividade", "Origem", "Área", "Status"),
      ...d.planoAcao.map(p => [p.ordem, p.prazo, p.prioridade, W(p.atividade), p.origem, p.area, p.status])]
  });

  sheets.push({
    name: "10_Lucro_Mensal_ECD", cols: [8, 6, 10, 18, 14, 46, 10], freeze: 4,
    rows: [...head("LUCRO MENSAL RECONSTRUÍDO (ECD)", "Requer validação contra os lançamentos de encerramento antes de divulgar."),
      H("Ano", "Mês", "Período", "Lucro contábil", "Encerramento?", "Método", "Linha"),
      ...d.lucroMensal.map(m => [m.ano, m.mes, m.periodo, M(m.lucro), m.encerramento ? "sim" : "não", m.metodo, m.linha])]
  });

  sheets.push({
    name: "11_Trilha", cols: [38, 20, 34, 10],
    rows: [...head("MEMÓRIA DE CÁLCULO — ÚLTIMO EXERCÍCIO", `De onde saiu cada rubrica no último período de ${d.trilha?.ano ?? "n/d"} (linha do arquivo da ECF).`),
      H("Rubrica (DRE)", "Valor", "Como foi localizada", "Linha"),
      ...(d.trilha?.dre ?? []).map(t => [t.rubrica, M(t.value), t.how, t.line ?? ""]),
      [],
      H("Rubrica (balanço)", "Valor", "Como foi localizada", "Linha"),
      ...(d.trilha?.bp ?? []).map(t => [t.rubrica, M(t.value), t.how, t.line ?? ""])]
  });

  sheets.push({
    name: "12_Fontes", cols: [8, 7, 40, 26, 9, 68, 12, 10, 50], freeze: 4,
    rows: [...head("INVENTÁRIO DOS ARQUIVOS", "O SHA-256 identifica exatamente o arquivo analisado. Os arquivos não são armazenados pelo CRM."),
      H("Ano", "Tipo", "Arquivo", "Período", "Usado?", "SHA-256", "Bytes", "Linhas", "Registros lidos"),
      ...d.fontes.map(f => [f.ano, f.tipo, f.arquivo, f.periodo, f.usado ? "sim" : "não", f.sha256, f.bytes ?? "", f.linhas,
        Object.entries(f.registros).map(([k, n]) => `${k}: ${n}`).join(" · ")])]
  });

  sheets.push({
    name: "13_Metodologia", cols: [28, 70, 28, 60],
    rows: [...head("FICHA METODOLÓGICA", "Lógica determinística: mesma entrada, mesma saída. Nenhum valor é estimado."),
      H("Indicador", "Fórmula", "Fonte", "Validação / restrição"),
      ...d.metodologia.map(m => [m.indicador, W(m.formula), m.fonte, W(m.validacao)]),
      [],
      ...d.indicadores.map(i => [i.nome, W(i.formula), i.fonte, ""])]
  });
  return sheets;
}

export const diagnosticXlsx = d => buildXlsx(diagnosticSheets(d));
