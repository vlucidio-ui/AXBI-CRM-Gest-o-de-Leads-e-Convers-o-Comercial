// AXBI-DIAG-CORE — motor determinístico do diagnóstico de demonstrações contábeis.
// Entrada: escriturações já lidas por parseSped (ECF e ECD). Saída: um objeto JSON com DRE, balanço,
// indicadores, conciliação ECD × ECF, achados e plano de ação. Mesma entrada => mesma saída.
// Nada aqui usa IA nem estimativas: o que não está nos arquivos sai como null ("n/d").
// Valores monetários em CENTAVOS (inteiros); índices e percentuais como fração (0,25 = 25%).

export const ENGINE_VERSION = "axbi-diag-core/1.0";
export const TOLERANCE_CENTS = 1; // materialidade aritmética: até R$ 0,01

const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
export const brl = cents => cents === null || cents === undefined ? "n/d"
  : (cents < 0 ? "-" : "") + "R$ " + (Math.abs(cents) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = v => v === null ? "n/d" : (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
const ratio = (a, b) => a === null || b === null || b === 0 ? null : Math.round((a / b) * 1e6) / 1e6;
const add = (...v) => v.some(x => x === null || x === undefined) ? null : v.reduce((s, x) => s + x, 0);
const sub = (a, b) => a === null || b === null ? null : a - b;

// Rubricas do plano referencial da ECF (P150 no Lucro Presumido). A busca é pelo código; se o
// leiaute usar outro código (ex.: L300 do Lucro Real), cai para a descrição oficial da rubrica.
const DRE_ROWS = [
  { key: "rb", label: "Receita bruta", codes: ["3.01.01.01.01"], names: [/^RECEITA BRUTA/] },
  { key: "ded", label: "(−) Deduções da receita bruta", codes: ["3.01.01.01.02"], names: [/DEDUCOES DA RECEITA/] },
  { key: "rl", label: "Receita líquida", codes: ["3.01.01.01"], names: [/^RECEITA LIQUIDA/] },
  { key: "custos", label: "(−) Custos dos bens e serviços", codes: ["3.01.01.03"], names: [/^(\(-\) ?)?CUSTO/] },
  { key: "outrasRec", label: "Outras receitas operacionais", codes: ["3.01.01.05"], names: [/^OUTRAS RECEITAS OPERACIONAIS/] },
  { key: "despOp", label: "(−) Despesas operacionais", codes: ["3.01.01.07"], names: [/^(\(-\) ?)?DESPESAS OPERACIONAIS/] },
  { key: "outrasDesp", label: "(−) Outras despesas operacionais", codes: ["3.01.01.09"], names: [/^(\(-\) ?)?OUTRAS DESPESAS OPERACIONAIS/] },
  { key: "resOper", label: "Resultado operacional", codes: ["3.01.01"], names: [/^RESULTADO OPERACIONAL/] },
  { key: "resAntes", label: "Resultado antes do IRPJ e da CSLL", codes: ["3.01"], names: [/RESULTADO.*ANTES/] },
  { key: "prov", label: "(−) Provisão de IRPJ e CSLL", codes: ["3.02"], names: [/PROVIS.*(IRPJ|IMPOSTO|CSLL|CONTRIBUICAO SOCIAL)/] },
  { key: "ll", label: "Lucro líquido do período", codes: ["3"], names: [/^(RESULTADO|LUCRO) LIQUIDO/] }
];
const BP_ROWS = [
  { key: "ativo", label: "Ativo total", codes: ["1"], names: [/^ATIVO( TOTAL)?$/] },
  { key: "ac", label: "Ativo circulante", codes: ["1.01"], names: [/^ATIVO CIRCULANTE/] },
  { key: "disp", label: "Disponibilidades", codes: ["1.01.01"], names: [/^DISPONIBILIDADES/, /^DISPONIVEL/] },
  { key: "cred", label: "Créditos", codes: ["1.01.02"], names: [/^CREDITOS/] },
  { key: "estoques", label: "Estoques", codes: ["1.01.03"], names: [/^ESTOQUES/] },
  { key: "anc", label: "Ativo não circulante", codes: ["1.02"], names: [/^ATIVO NAO.?CIRCULANTE/] },
  { key: "passivoTotal", label: "Passivo e patrimônio líquido", codes: ["2"], names: [/^PASSIVO( TOTAL| E PATRIMONIO LIQUIDO)?$/] },
  { key: "pc", label: "Passivo circulante", codes: ["2.01"], names: [/^PASSIVO CIRCULANTE/] },
  { key: "pnc", label: "Passivo não circulante", codes: ["2.02"], names: [/^PASSIVO NAO.?CIRCULANTE/] },
  { key: "pl", label: "Patrimônio líquido", codes: ["2.03"], names: [/^PATRIMONIO LIQUIDO/] }
];

/** Localiza uma rubrica: por código; sem valor próprio, soma as analíticas filhas; por fim, pela descrição. */
function pick(rows, def) {
  for (const code of def.codes) {
    const row = rows.find(r => r.code === code);
    const kids = rows.filter(r => r.code.startsWith(code + ".") && r.kind === "A");
    const kidsSum = kids.reduce((s, r) => s + (r.value ?? 0), 0);
    if (row && (row.value !== 0 || !kids.length || kidsSum === 0)) return { value: row.value, line: row.line, how: "código " + code };
    if (kids.length) return { value: kidsSum, line: (row ?? kids[0]).line, how: "soma das analíticas de " + code };
  }
  const byName = rows.filter(r => def.names.some(re => re.test(norm(r.name)))).sort((a, b) => a.level - b.level)[0];
  return byName ? { value: byName.value, line: byName.line, how: "descrição “" + byName.name + "”" } : { value: null, line: null, how: "não localizada" };
}

const quarterOf = code => /^T0[1-4]$/.test(code) ? Number(code[2]) : 0;

/** Entre arquivos do mesmo tipo e ano, fica a retificadora; empatando, o último enviado. */
function chooseByYear(files, type, notes) {
  const map = new Map();
  for (const f of files.filter(x => x.type === type && x.year)) {
    const cur = map.get(f.year);
    if (cur) {
      const keep = type === "ECF" && cur.retificadora === "S" && f.retificadora !== "S" ? cur : f;
      const drop = keep === cur ? f : cur;
      notes.push({ year: f.year, type, kept: keep.fileName, dropped: drop.fileName });
      map.set(f.year, keep);
    } else map.set(f.year, f);
  }
  return map;
}

function ecfYear(file) {
  const quarters = file.periods.filter(p => quarterOf(p.code)).sort((a, b) => quarterOf(a.code) - quarterOf(b.code));
  const annual = file.periods.find(p => p.code === "A00");
  const used = quarters.length ? quarters : annual ? [annual] : [];
  const tri = quarters.map(p => {
    const d = Object.fromEntries(DRE_ROWS.map(def => [def.key, pick(p.dre, def).value]));
    const b = Object.fromEntries(BP_ROWS.map(def => [def.key, pick(p.bp, def).value]));
    return { ano: file.year, tri: quarterOf(p.code), dataBase: p.dtFin, linha: p.line, dre: { ...d, lb: add(d.rl, d.custos) }, bp: b };
  });
  // DRE anual: soma dos trimestres (ou o período anual A00). Balanço: último período.
  const dre = {};
  for (const def of DRE_ROWS) {
    const vals = used.map(p => pick(p.dre, def).value);
    dre[def.key] = vals.length && vals.every(v => v !== null) ? vals.reduce((s, v) => s + v, 0) : null;
  }
  dre.lb = add(dre.rl, dre.custos);
  const last = used[used.length - 1];
  const bp = Object.fromEntries(BP_ROWS.map(def => [def.key, last ? pick(last.bp, def).value : null]));
  const trilha = last ? {
    dre: DRE_ROWS.map(def => ({ rubrica: def.label, ...pick(last.dre, def) })),
    bp: BP_ROWS.map(def => ({ rubrica: def.label, ...pick(last.bp, def) }))
  } : { dre: [], bp: [] };
  const bpDetalhe = last ? last.bp.filter(r => r.level <= 3).map(r => ({ codigo: r.code, rubrica: r.name, nivel: r.level, valor: r.value, linha: r.line })) : [];
  return { tri, dre, bp, trilha, bpDetalhe, regime: used[0]?.regime ?? "", trimestres: quarters.length, anual: !quarters.length && !!annual };
}

const J150 = {
  rb: [/^RECEITA( OPERACIONAL)? BRUTA/],
  ded: [/^(\(-\) ?)?DEDUCOES/],
  rl: [/^RECEITA( OPERACIONAL)? LIQUIDA/],
  ll: [/^(LUCRO|RESULTADO|PREJUIZO)( OU PREJUIZO)? LIQUIDO/, /^RESULTADO DO (EXERCICIO|PERIODO)/]
};
const J100 = {
  ativo: [/^ATIVO( TOTAL)?$/, /^TOTAL DO ATIVO/],
  ac: [/^ATIVO CIRCULANTE/],
  pc: [/^PASSIVO CIRCULANTE/],
  pl: [/^PATRIMONIO LIQUIDO/]
};
const byName = (rows, res) => rows.filter(r => res.some(re => re.test(norm(r.name)))).sort((a, b) => a.level - b.level)[0] ?? null;

function ecdYear(file) {
  const fim = file.dtFin;
  const demo = rows => { const f = rows.filter(r => !r.period || r.period === fim); return f.length ? f : rows; };
  const j150 = demo(file.j150), j100 = demo(file.j100);
  const dre = Object.fromEntries(Object.entries(J150).map(([k, res]) => [k, byName(j150, res)?.value ?? null]));
  const bp = Object.fromEntries(Object.entries(J100).map(([k, res]) => [k, byName(j100, res)?.value ?? null]));
  const lucroEncerramento = file.closings.length ? file.closings.reduce((s, c) => s + c.rows.reduce((t, r) => t + r.value, 0), 0) : null;

  // Lucro mensal: movimento (crédito − débito) das contas de resultado em cada I150. No mês de
  // encerramento o movimento inclui o zeramento das contas, então vale I355 − meses anteriores.
  const resultado = code => file.accounts[code]?.nature === "04";
  const mensal = [];
  let acumulado = 0;
  for (const m of [...file.months].sort((a, b) => a.dtFin.localeCompare(b.dtFin))) {
    const closing = file.closings.find(c => c.date === m.dtFin);
    const movimento = m.rows.filter(r => resultado(r.account)).reduce((s, r) => s + r.credit - r.debit, 0);
    let lucro = movimento, metodo = "I155: crédito − débito das contas de resultado";
    if (closing) {
      lucro = closing.rows.reduce((s, r) => s + r.value, 0) - acumulado;
      metodo = "I355 do encerramento − meses anteriores";
      acumulado = 0;
    } else acumulado += movimento;
    mensal.push({ ano: file.year, mes: Number(m.dtFin.slice(5, 7)), periodo: m.dtFin.slice(0, 7), lucro, encerramento: !!closing, metodo, linha: m.line });
  }
  return { dre, bp, lucroEncerramento, mensal, demonstracoes: file.demoPeriods.length };
}

// Faixas de referência AXBI para os semáforos (ponto de partida; variam por setor e devem ser
// revistas pelo analista antes da entrega).
const INDICATORS = [
  { key: "liquidezCorrente", nome: "Liquidez corrente", formula: "Ativo circulante ÷ passivo circulante", fonte: "ECF, balanço do último período", tipo: "indice", melhor: "maior", verde: 1.2, amarelo: 1, calc: c => ratio(c.bp.ac, c.bp.pc) },
  { key: "liquidezSeca", nome: "Liquidez seca", formula: "(Ativo circulante − estoques) ÷ passivo circulante", fonte: "ECF, balanço do último período", tipo: "indice", melhor: "maior", verde: 1, amarelo: 0.8, calc: c => ratio(sub(c.bp.ac, c.bp.estoques ?? 0), c.bp.pc) },
  { key: "liquidezImediata", nome: "Liquidez imediata", formula: "Disponibilidades ÷ passivo circulante", fonte: "ECF, balanço do último período", tipo: "indice", melhor: "maior", verde: 0.3, amarelo: 0.2, calc: c => ratio(c.bp.disp, c.bp.pc) },
  { key: "capitalGiro", nome: "Capital de giro líquido", formula: "Ativo circulante − passivo circulante", fonte: "ECF, balanço do último período", tipo: "moeda", melhor: "maior", verde: 0, amarelo: 0, calc: c => sub(c.bp.ac, c.bp.pc) },
  { key: "endividamento", nome: "Endividamento total", formula: "(Passivo circulante + não circulante) ÷ ativo total", fonte: "ECF, balanço do último período", tipo: "percentual", melhor: "menor", verde: 0.5, amarelo: 0.7, calc: c => ratio(add(c.bp.pc, c.bp.pnc ?? 0), c.bp.ativo) },
  { key: "terceirosPl", nome: "Capital de terceiros ÷ patrimônio líquido", formula: "(Passivo circulante + não circulante) ÷ patrimônio líquido", fonte: "ECF, balanço do último período", tipo: "indice", melhor: "menor", verde: 1, amarelo: 2, calc: c => c.bp.pl !== null && c.bp.pl <= 0 ? null : ratio(add(c.bp.pc, c.bp.pnc ?? 0), c.bp.pl) },
  { key: "margemBruta", nome: "Margem bruta", formula: "Lucro bruto ÷ receita líquida", fonte: "ECF, DRE do ano", tipo: "percentual", melhor: "maior", verde: 0.5, amarelo: 0.3, calc: c => ratio(c.dre.lb, c.dre.rl) },
  { key: "margemOperacional", nome: "Margem operacional", formula: "Resultado operacional ÷ receita líquida", fonte: "ECF, DRE do ano", tipo: "percentual", melhor: "maior", verde: 0.3, amarelo: 0.15, calc: c => ratio(c.dre.resOper, c.dre.rl) },
  { key: "margemLiquida", nome: "Margem líquida", formula: "Lucro líquido ÷ receita líquida", fonte: "ECF, DRE do ano", tipo: "percentual", melhor: "maior", verde: 0.15, amarelo: 0.08, calc: c => ratio(c.dre.ll, c.dre.rl) },
  { key: "roa", nome: "Retorno sobre o ativo (ROA)", formula: "Lucro líquido ÷ ativo total médio (exige o ano anterior)", fonte: "ECF, DRE e balanços", tipo: "percentual", melhor: "maior", verde: 0.1, amarelo: 0.05, calc: (c, p) => p ? ratio(c.dre.ll, add(c.bp.ativo, p.bp.ativo) === null ? null : add(c.bp.ativo, p.bp.ativo) / 2) : null },
  { key: "cargaTributaria", nome: "Carga tributária efetiva (declarada)", formula: "(Deduções + provisão de IRPJ/CSLL) ÷ receita bruta", fonte: "ECF, DRE do ano", tipo: "percentual", melhor: "menor", verde: 0.2, amarelo: 0.3, calc: c => ratio(add(Math.abs(c.dre.ded ?? NaN), Math.abs(c.dre.prov ?? NaN)) || null, c.dre.rb) },
  { key: "varReceita", nome: "Variação da receita líquida", formula: "Receita líquida do ano ÷ receita líquida do ano anterior − 1", fonte: "ECF, DRE", tipo: "percentual", melhor: null, calc: (c, p) => p && ratio(c.dre.rl, p.dre.rl) !== null ? Math.round((c.dre.rl / p.dre.rl - 1) * 1e6) / 1e6 : null },
  { key: "varLucro", nome: "Variação do lucro líquido", formula: "Lucro líquido do ano ÷ lucro líquido do ano anterior − 1", fonte: "ECF, DRE", tipo: "percentual", melhor: null, calc: (c, p) => p && p.dre.ll > 0 && c.dre.ll !== null ? Math.round((c.dre.ll / p.dre.ll - 1) * 1e6) / 1e6 : null }
];

export function trafficLight(def, value) {
  if (value === null || value === undefined || !def.melhor) return null;
  if (def.melhor === "maior") return value >= def.verde ? "verde" : value >= def.amarelo && def.amarelo !== def.verde ? "amarelo" : "vermelho";
  return value <= def.verde ? "verde" : value <= def.amarelo ? "amarelo" : "vermelho";
}

/**
 * Monta o diagnóstico. `files`: resultados de parseSped (ok: true), cada um podendo trazer
 * `sha256` e `bytes` informados por quem leu o arquivo. `now` só carimba a data de geração.
 */
export function buildDiagnostic(files, { now = new Date() } = {}) {
  const valid = files.filter(f => f && f.ok);
  const cnpjs = [...new Set(valid.map(f => f.cnpj).filter(Boolean))];
  const substituicoes = [];
  const ecfs = chooseByYear(valid, "ECF", substituicoes);
  const ecds = chooseByYear(valid, "ECD", substituicoes);
  const anos = [...new Set([...ecfs.keys(), ...ecds.keys()])].sort((a, b) => a - b);
  const F = Object.fromEntries([...ecfs].map(([y, f]) => [y, ecfYear(f)]));
  const D = Object.fromEntries([...ecds].map(([y, f]) => [y, ecdYear(f)]));
  const usados = new Set([...ecfs.values(), ...ecds.values()]);

  const fontes = valid.map(f => ({
    arquivo: f.fileName, tipo: f.type, ano: f.year, periodo: `${f.dtIni} a ${f.dtFin}`, cnpj: f.cnpj,
    sha256: f.sha256 ?? "", bytes: f.bytes ?? null, linhas: f.lineCount, registros: f.counts,
    usado: usados.has(f), retificadora: f.type === "ECF" ? f.retificadora : "", avisos: f.warnings
  }));

  const dreAnual = [...DRE_ROWS.slice(0, 4), { key: "lb", label: "Lucro bruto (calculado)" }, ...DRE_ROWS.slice(4)]
    .map(def => ({ chave: def.key, rotulo: def.label, valores: Object.fromEntries(anos.map(y => [y, F[y]?.dre[def.key] ?? null])) }));
  const dreTrimestral = anos.flatMap(y => (F[y]?.tri ?? []).map(t => ({ ano: t.ano, tri: t.tri, dataBase: t.dataBase, linha: t.linha, ...t.dre })));
  const bpTrimestral = anos.flatMap(y => (F[y]?.tri ?? []).map(t => ({ ano: t.ano, tri: t.tri, dataBase: t.dataBase, linha: t.linha, ...t.bp })));
  const bpAnual = BP_ROWS.map(def => ({ chave: def.key, rotulo: def.label, valores: Object.fromEntries(anos.map(y => [y, F[y]?.bp[def.key] ?? null])) }));
  const codigos = [...new Map(anos.flatMap(y => (F[y]?.bpDetalhe ?? []).map(r => [r.codigo, r]))).values()].sort((a, b) => a.codigo.localeCompare(b.codigo, "pt", { numeric: true }));
  const bpDetalhe = codigos.map(r => ({
    codigo: r.codigo, rubrica: r.rubrica, nivel: r.nivel,
    valores: Object.fromEntries(anos.map(y => [y, F[y]?.bpDetalhe.find(x => x.codigo === r.codigo)?.valor ?? null]))
  }));

  const indicadores = INDICATORS.map(def => ({
    chave: def.key, nome: def.nome, formula: def.formula, fonte: def.fonte, tipo: def.tipo, melhor: def.melhor,
    verde: def.verde ?? null, amarelo: def.amarelo ?? null,
    valores: Object.fromEntries(anos.map(y => {
      const v = F[y] ? def.calc(F[y], F[y - 1] ?? null) : null;
      const valor = v === null || v === undefined || Number.isNaN(v) ? null : v;
      return [y, { valor, semaforo: trafficLight(def, valor) }];
    }))
  }));
  const ind = (key, y) => indicadores.find(i => i.chave === key)?.valores[y] ?? { valor: null, semaforo: null };

  // Conciliação ECD × ECF por ano e rubrica.
  const CONC = [
    ["Receita bruta", y => D[y].dre.rb, y => F[y].dre.rb, "J150", "DRE (P150/L300)"],
    ["Deduções da receita", y => D[y].dre.ded, y => F[y].dre.ded, "J150", "DRE (P150/L300)"],
    ["Receita líquida", y => D[y].dre.rl, y => F[y].dre.rl, "J150", "DRE (P150/L300)"],
    ["Lucro líquido", y => D[y].lucroEncerramento ?? D[y].dre.ll, y => F[y].dre.ll, "I350/I355", "DRE (P150/L300)"],
    ["Ativo total", y => D[y].bp.ativo, y => F[y].bp.ativo, "J100", "Balanço (P100/L100)"]
  ];
  const conciliacao = anos.filter(y => F[y] && D[y]).flatMap(y => CONC.map(([rubrica, ecd, ecf, fonteEcd, fonteEcf]) => {
    const a = ecd(y), b = ecf(y);
    const diferenca = a === null || b === null ? null : b - a;
    return {
      ano: y, rubrica, ecd: a, ecf: b, diferenca, fonteEcd, fonteEcf,
      situacao: diferenca === null ? "Não comparável" : Math.abs(diferenca) <= TOLERANCE_CENTS ? "Conciliado" : "Divergência"
    };
  }));

  // Controles aritméticos internos da ECF.
  const controles = anos.filter(y => F[y]).map(y => {
    const { dre, bp } = F[y];
    return {
      ano: y,
      ativoMenosPassivo: sub(bp.ativo, bp.passivoTotal),
      receitaLiquida: dre.rl === null ? null : sub(add(dre.rb, dre.ded), dre.rl),
      lucroLiquido: dre.ll === null ? null : sub(add(dre.resAntes, dre.prov), dre.ll)
    };
  });
  const lucroMensal = anos.flatMap(y => D[y]?.mensal ?? []);

  // ---------------------------------------------------------------- achados (motor de regras)
  const achados = [];
  const achado = (prioridade, area, texto, impacto, acao, situacao = "Aberto") => achados.push({ prioridade, area, achado: texto, impacto, acao, situacao });

  if (cnpjs.length > 1) achado("Alta", "Documentos", `Os arquivos trazem CNPJs diferentes: ${cnpjs.join(", ")}.`, "Mistura de empresas invalida o diagnóstico", "Reenviar somente os arquivos da empresa analisada");
  for (const s of substituicoes) achado("Média", `Documentos ${s.year}`, `Há mais de uma ${s.type} de ${s.year}: foi usada “${s.kept}” e desconsiderada “${s.dropped}”.`, "Risco de analisar versão que não é a última transmitida", "Confirmar pelo recibo qual versão está vigente");
  for (const y of anos) {
    if (!F[y]) achado("Média", `Documentos ${y}`, `ECF de ${y} não recebida: sem DRE fiscal nem balanço referencial do ano.`, "Indicadores e conciliação do ano indisponíveis", "Solicitar a ECF do exercício");
    if (!D[y]) achado("Média", `Documentos ${y}`, `ECD de ${y} não recebida: não foi possível conciliar a contabilidade com a ECF.`, "Conciliação ECD × ECF do ano indisponível", "Solicitar a ECD do exercício");
    if (F[y] && !F[y].anual && F[y].trimestres < 4) achado("Média", `Documentos ${y}`, `A ECF de ${y} traz ${F[y].trimestres} trimestre(s) de apuração, não quatro.`, "DRE anual incompleta", "Verificar início de atividade, situação especial ou arquivo incompleto");
  }
  for (const y of [...anos].filter(v => v > anos[0] && !anos.includes(v - 1))) achado("Baixa", "Documentos", `Não há arquivos de ${y - 1}: variações de ${y} sobre o ano anterior não foram calculadas.`, "Série histórica com lacuna", "Enviar o exercício faltante, se existir", "Informativo");
  for (const f of valid) for (const w of f.warnings) achado("Média", `Leitura ${f.type} ${f.year || ""}`.trim(), `${f.fileName}: ${w}`, "Dado possivelmente incompleto", "Conferir o arquivo original");

  for (const c of conciliacao.filter(x => x.situacao === "Divergência")) {
    achado("Alta", `${c.rubrica} ${c.ano}`, `ECF (${c.fonteEcf}) ${brl(c.ecf)} × ECD (${c.fonteEcd}) ${brl(c.ecd)}: diferença de ${brl(c.diferenca)}.`,
      "Contabilidade e declaração fiscal não coincidem", "Abrir a diferença por conta e lançamento; retificar a escrituração que estiver errada");
  }
  for (const c of controles) {
    if (c.ativoMenosPassivo !== null && Math.abs(c.ativoMenosPassivo) > TOLERANCE_CENTS) achado("Alta", `Balanço ${c.ano}`, `Na ECF, o ativo difere do passivo + patrimônio líquido em ${brl(c.ativoMenosPassivo)}.`, "Balanço referencial não fecha", "Revisar o mapeamento das contas para o plano referencial");
    if (c.lucroLiquido !== null && Math.abs(c.lucroLiquido) > TOLERANCE_CENTS) achado("Média", `DRE ${c.ano}`, `Resultado antes dos tributos + provisão difere do lucro líquido declarado em ${brl(c.lucroLiquido)}.`, "DRE referencial com diferença interna", "Conferir as rubricas de provisão e participações na ECF");
  }
  for (const y of anos.filter(v => F[v])) {
    const cur = F[y], prev = F[y - 1];
    const vr = ind("varReceita", y).valor;
    if (vr !== null && vr <= -0.2) achado("Alta", `Receita ${y}`, `A receita líquida caiu ${pct(-vr)} em relação a ${y - 1} (${brl(prev.dre.rl)} → ${brl(cur.dre.rl)}).`, "Perda de faturamento", "Decompor a queda por cliente, produto e mês");
    if (prev && vr !== null && vr < 0 && cur.dre.custos !== null && prev.dre.custos !== null && Math.abs(cur.dre.custos) > Math.abs(prev.dre.custos)) {
      achado("Alta", `Margem e custos ${y}`, `A receita líquida recuou ${pct(-vr)} enquanto os custos subiram de ${brl(Math.abs(prev.dre.custos))} para ${brl(Math.abs(cur.dre.custos))}.`, "Perda de eficiência operacional", "Detalhar os custos por conta e centro de custo");
    }
    if (cur.dre.ll !== null && cur.dre.ll < 0) achado("Alta", `Resultado ${y}`, `O exercício fechou com prejuízo de ${brl(Math.abs(cur.dre.ll))}.`, "Consumo de patrimônio", "Identificar as linhas que levaram ao prejuízo e o plano de reversão");
    const lc = ind("liquidezCorrente", y);
    if (lc.semaforo === "vermelho") achado("Alta", `Liquidez ${y}`, `Liquidez corrente de ${lc.valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}: o ativo circulante não cobre o passivo circulante (capital de giro de ${brl(ind("capitalGiro", y).valor)}).`, "Pressão de caixa no curto prazo", "Abrir o passivo circulante por vencimento e natureza");
    else if (lc.semaforo === "amarelo") achado("Média", `Liquidez ${y}`, `Liquidez corrente de ${lc.valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}, abaixo da faixa de referência (1,20).`, "Folga de curto prazo reduzida", "Acompanhar mensalmente o capital de giro", "Sinal de atenção");
    if (cur.bp.pl !== null && cur.bp.pl <= 0) achado("Alta", `Patrimônio ${y}`, `Patrimônio líquido de ${brl(cur.bp.pl)} (passivo a descoberto).`, "Insolvência contábil", "Avaliar aporte, capitalização de dívidas ou reestruturação");
    const total = cur.dre.rb;
    const top = [...cur.tri].sort((a, b) => (b.dre.rb ?? 0) - (a.dre.rb ?? 0))[0];
    if (cur.tri.length === 4 && total > 0 && top.dre.rb / total >= 0.4) achado("Média", `Sazonalidade ${y}`, `O ${top.tri}º trimestre concentra ${pct(top.dre.rb / total)} da receita bruta do ano.`, "Comparações trimestrais limitadas", "Verificar se a concentração é recorrente", "Monitorar");
    for (const def of DRE_ROWS.filter(d => ["rb", "rl", "ll"].includes(d.key))) {
      if (cur.dre[def.key] === null) achado("Média", `Leitura ECF ${y}`, `Rubrica “${def.label}” não localizada na DRE da ECF.`, "Indicadores dependentes ficam como n/d", "Conferir o leiaute do arquivo");
    }
  }
  // Limites que valem para qualquer diagnóstico feito só com ECD e ECF.
  achado("Baixa", "Tributos", "A provisão de IRPJ/CSLL da DRE não comprova recolhimento.", "Leitura fiscal indevida", "Tratar como provisão; cruzar com DCTF/DARF em análise fiscal própria", "Aplicado");
  achado("Baixa", "Caixa", "A ECD não equivale a extrato bancário nem mostra vencimentos.", "Extrapolação da liquidez", "Limitar as conclusões ao balanço contábil; conciliar bancos à parte", "Aplicado");
  if (lucroMensal.length) achado("Média", "DRE mensal", "Os lucros mensais são reconstruídos pelos saldos I155 e pelos encerramentos I355.", "Atribuição mensal sujeita a lançamentos de ajuste", "Validar contra os lançamentos de encerramento antes de divulgar", "Em validação");

  const ordem = { Alta: 0, Média: 1, Baixa: 2 };
  achados.sort((a, b) => ordem[a.prioridade] - ordem[b.prioridade]);
  achados.forEach((a, i) => { a.id = "R" + String(i + 1).padStart(2, "0"); });
  const prazo = { Alta: "Imediato", Média: "Curto prazo", Baixa: "Contínuo" };
  const planoAcao = achados.filter(a => a.situacao !== "Aplicado" && a.situacao !== "Informativo")
    .map((a, i) => ({ ordem: i + 1, prazo: prazo[a.prioridade], prioridade: a.prioridade, atividade: a.acao, origem: a.id, area: a.area, status: "Pendente" }));

  const ultimo = [...anos].reverse().find(y => F[y]) ?? null;
  const resumo = ultimo === null ? null : {
    ano: ultimo, receitaLiquida: F[ultimo].dre.rl, lucroLiquido: F[ultimo].dre.ll,
    varReceita: ind("varReceita", ultimo).valor, margemLiquida: ind("margemLiquida", ultimo).valor,
    liquidezCorrente: ind("liquidezCorrente", ultimo).valor,
    achadosAltos: achados.filter(a => a.prioridade === "Alta").length,
    divergencias: conciliacao.filter(c => c.situacao === "Divergência").length,
    conciliados: conciliacao.filter(c => c.situacao === "Conciliado").length
  };

  return {
    versao: ENGINE_VERSION, geradoEm: now.toISOString(),
    empresa: { cnpj: cnpjs[0] ?? "", nome: valid.find(f => f.name)?.name ?? "" },
    anos, regime: ultimo === null ? "" : F[ultimo].regime, resumo, fontes,
    dreAnual, dreTrimestral, bpAnual, bpTrimestral, bpDetalhe, indicadores, conciliacao, controles, lucroMensal,
    trilha: ultimo === null ? null : { ano: ultimo, ...F[ultimo].trilha },
    achados, planoAcao, metodologia: METHODOLOGY, limites: LIMITS
  };
}

export const METHODOLOGY = [
  { indicador: "Receita bruta anual", formula: "Soma da rubrica de receita bruta da DRE da ECF nos períodos do ano", fonte: "ECF P150/L300", validacao: "ECD J150" },
  { indicador: "Receita líquida", formula: "Rubrica própria da ECF; controle: receita bruta + deduções", fonte: "ECF P150/L300", validacao: "ECD J150" },
  { indicador: "Lucro líquido", formula: "Rubrica própria da ECF; controle: resultado antes dos tributos + provisões", fonte: "ECF P150/L300", validacao: "ECD I350/I355" },
  { indicador: "Lucro bruto", formula: "Receita líquida + custos (negativos)", fonte: "Calculado", validacao: "—" },
  { indicador: "Balanço", formula: "Saldos finais do último período de apuração do ano", fonte: "ECF P100/L100", validacao: "ECD J100 e ativo = passivo + PL" },
  { indicador: "Lucro mensal", formula: "Crédito − débito das contas de resultado (I155); no encerramento, I355 − meses anteriores", fonte: "ECD I050/I155/I350/I355", validacao: "Soma anual = I355" },
  { indicador: "Conciliação ECD × ECF", formula: "ECF − ECD por rubrica; conciliado se a diferença for de até R$ 0,01", fonte: "ECD + ECF", validacao: "Teste em centavos" },
  { indicador: "EBITDA", formula: "Não apurado", fonte: "—", validacao: "Depreciação e amortização não vêm segregadas; o valor não é estimado" }
];
export const LIMITS = [
  "Diagnóstico gerado automaticamente a partir das escriturações enviadas; não é auditoria nem parecer.",
  "Todo número vem de um registro do arquivo ou de uma fórmula listada na metodologia; o que não foi localizado aparece como n/d.",
  "As faixas dos semáforos são referências iniciais da AXBI e variam por setor.",
  "As conclusões precisam de revisão e aprovação de um profissional antes da entrega ao cliente."
];
