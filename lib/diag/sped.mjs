// AXBI-DIAG-CORE — leitura de escriturações SPED (ECF e ECD).
// Funções puras, sem rede e sem IA: o arquivo é lido linha a linha e só os registros usados no
// diagnóstico são guardados, cada um com o número da linha de origem (rastreabilidade).
// Valores monetários são inteiros em CENTAVOS (nunca ponto flutuante).

/** "1.234,56" ou "1234,56" -> 123456 (centavos). Campo vazio -> 0. Valor inválido -> null. */
export function parseCents(raw) {
  const s = String(raw ?? "").trim();
  if (s === "") return 0;
  if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(s)) return null;
  const neg = s.startsWith("-");
  const [int, dec = ""] = s.replace("-", "").replace(/\./g, "").split(",");
  const cents = Number(int) * 100 + Number((dec + "00").slice(0, 2));
  return neg ? -cents : cents;
}

/** "31122025" -> "2025-12-31"; inválida -> "". */
export function parseDate(raw) {
  const s = String(raw ?? "").trim();
  if (!/^\d{8}$/.test(s)) return "";
  const d = s.slice(0, 2), m = s.slice(2, 4), y = s.slice(4);
  if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return "";
  return `${y}-${m}-${d}`;
}

const isDC = v => v === "D" || v === "C";
const isMoney = v => /^\d[\d.]*,\d+$/.test(v);

/** Campos de uma linha SPED, sem o nome do registro: "|P150|1|X|" -> ["1","X"]. */
function fields(line) {
  const p = line.split("|");
  return p.slice(2, p[p.length - 1].trim() === "" ? -1 : undefined).map(x => x.trim());
}

/** Valor com sinal segundo o indicador D/C. `positive` diz qual natureza conta como positiva. */
function signed(cents, dc, positive) {
  if (cents === null) return null;
  return dc === positive || cents === 0 ? cents : -cents;
}

/** Pares (valor, D/C) de uma linha, na ordem em que aparecem. Só valores com vírgula decimal. */
function moneyPairs(f, from = 0) {
  const out = [];
  for (let i = from; i < f.length - 1; i++) {
    if (isMoney(f[i]) && isDC(f[i + 1])) { out.push({ cents: parseCents(f[i]), dc: f[i + 1] }); i++; }
  }
  return out;
}

function firstDates(f) {
  return f.map(parseDate).filter(Boolean);
}

/**
 * Lê uma escrituração. Retorna { ok, type, ... } ou { ok: false, error }.
 * type "ECF": periods[] com balanço (P100/L100) e DRE (P150/L300) por período de apuração.
 * type "ECD": plano de contas (I050), saldos mensais (I155), encerramentos (I355), J100 e J150.
 */
export function parseSped(text, fileName = "") {
  const lines = String(text ?? "").split(/\r?\n/);
  const head = lines.find(l => l.startsWith("|0000|")) ?? "";
  const h = head.split("|");
  const type = h[2] === "LECF" ? "ECF" : h[2] === "LECD" ? "ECD" : null;
  if (!type) {
    return { ok: false, fileName, error: "Arquivo não reconhecido: o registro 0000 não identifica uma ECF (LECF) nem uma ECD (LECD)." };
  }
  const hf = fields(head);
  const cnpj = hf.find(x => /^\d{14}$/.test(x)) ?? "";
  const dates = firstDates(hf);
  const base = {
    ok: true, type, fileName, cnpj, lineCount: lines.length, counts: {}, warnings: [],
    dtIni: dates[0] ?? "", dtFin: dates[1] ?? "", year: Number((dates[1] ?? dates[0] ?? "").slice(0, 4)) || 0
  };
  if (!cnpj) base.warnings.push("CNPJ não localizado no registro 0000.");
  if (!base.year) base.warnings.push("Período não localizado no registro 0000.");
  const count = reg => { base.counts[reg] = (base.counts[reg] ?? 0) + 1; };
  return type === "ECF" ? parseEcf(lines, hf, base, count) : parseEcd(lines, hf, base, count);
}

function parseEcf(lines, hf, base, count) {
  // |0000|LECF|COD_VER|CNPJ|NOME|...|DT_INI|DT_FIN|RETIFICADORA|NUM_REC|...
  const out = { ...base, layout: hf[1] ?? "", name: hf[3] ?? "", retificadora: "", periods: [] };
  const iFin = hf.findIndex(x => parseDate(x) === base.dtFin && base.dtFin);
  out.retificadora = iFin >= 0 ? (hf[iFin + 1] ?? "") : "";
  let cur = null;
  lines.forEach((line, idx) => {
    if (line.length < 6 || line[0] !== "|") return;
    const reg = line.slice(1, 5);
    if (reg === "P030" || reg === "L030") {
      const f = fields(line);
      cur = { regime: reg[0] === "P" ? "presumido" : "real", dtIni: parseDate(f[0]), dtFin: parseDate(f[1]), code: f[2] ?? "", line: idx + 1, bp: [], dre: [] };
      out.periods.push(cur);
      count(reg);
    } else if (reg === "P100" || reg === "L100" || reg === "P150" || reg === "L300") {
      if (!cur) return;
      const f = fields(line);
      const pairs = moneyPairs(f, 6);
      const last = pairs[pairs.length - 1];
      const isBp = reg === "P100" || reg === "L100";
      const code = f[0] ?? "";
      const row = {
        code, name: f[1] ?? "", kind: f[2] ?? "", level: Number(f[3]) || 0, parent: f[5] ?? "", line: idx + 1,
        value: last ? signed(last.cents, last.dc, isBp ? (code.startsWith("1") ? "D" : "C") : "C") : 0
      };
      if (last && last.cents === null) out.warnings.push(`Valor ilegível na linha ${idx + 1} (${reg}).`);
      (isBp ? cur.bp : cur.dre).push(row);
      count(reg);
    }
  });
  if (!out.periods.length) out.warnings.push("Nenhum período de apuração (P030/L030) encontrado.");
  return out;
}

function parseEcd(lines, hf, base, count) {
  // |0000|LECD|DT_INI|DT_FIN|NOME|CNPJ|...
  const out = {
    ...base, name: hf[3] ?? "", layout: "", accounts: {}, months: [], closings: [], j100: [], j150: [], demoPeriods: []
  };
  let month = null, closing = null, demo = null;
  lines.forEach((line, idx) => {
    if (line.length < 6 || line[0] !== "|") return;
    const reg = line.slice(1, 5);
    switch (reg) {
      case "I010": out.layout = fields(line)[1] ?? ""; break;
      case "I050": {
        // DT_ALT|COD_NAT|IND_CTA|NIVEL|COD_CTA|COD_CTA_SUP|CTA
        const f = fields(line);
        if (f[4]) out.accounts[f[4]] = { nature: f[1] ?? "", analytic: f[2] === "A", level: Number(f[3]) || 0, parent: f[5] ?? "", name: f[6] ?? "" };
        count(reg); break;
      }
      case "I150": {
        const f = fields(line);
        month = { dtIni: parseDate(f[0]), dtFin: parseDate(f[1]), line: idx + 1, rows: [] };
        out.months.push(month); count(reg); break;
      }
      case "I155": {
        // COD_CTA|COD_CCUS|VL_SLD_INI|IND|VL_DEB|VL_CRED|VL_SLD_FIN|IND
        if (!month) break;
        const f = fields(line);
        month.rows.push({ account: f[0] ?? "", debit: parseCents(f[4]) ?? 0, credit: parseCents(f[5]) ?? 0, line: idx + 1 });
        count(reg); break;
      }
      case "I350": {
        closing = { date: parseDate(fields(line)[0]), line: idx + 1, rows: [] };
        out.closings.push(closing); count(reg); break;
      }
      case "I355": {
        // COD_CTA|COD_CCUS|VL_CTA|IND_DC
        if (!closing) break;
        const f = fields(line);
        closing.rows.push({ account: f[0] ?? "", value: signed(parseCents(f[2]), f[3], "C") ?? 0, line: idx + 1 });
        count(reg); break;
      }
      case "J005": {
        const f = fields(line);
        demo = { dtIni: parseDate(f[0]), dtFin: parseDate(f[1]) };
        out.demoPeriods.push(demo); count(reg); break;
      }
      case "J100": case "J150": {
        const f = fields(line);
        const pairs = moneyPairs(f);
        if (!pairs.length) break;
        // Leiaute atual traz o indicador T/D (totalizador/detalhe) logo após o código; nele o saldo
        // final é o último par. No leiaute antigo o primeiro par é o saldo final.
        const iInd = f.findIndex((x, i) => i >= 1 && i <= 2 && (x === "T" || x === "D"));
        const novo = iInd >= 0;
        const fin = novo ? pairs[pairs.length - 1] : pairs[0];
        const iVal = f.findIndex(isMoney);
        const name = f[iVal - 1] ?? "";
        const code = novo ? f[iInd - 1] : f[0];
        const level = Number(novo ? f[iInd + 1] : f[1]) || 0;
        if (reg === "J100") {
          // Grupo do balanço: novo = COD|T/D|NIVEL|COD_SUP|A/P|...; antigo = COD|NIVEL|1/2|...
          const grp = novo ? f[iInd + 3] : f[2];
          const ativo = novo ? grp === "A" : grp === "1";
          out.j100.push({ code, name, level, group: ativo ? "A" : "P", value: signed(fin.cents, fin.dc, ativo ? "D" : "C") ?? 0, period: demo?.dtFin ?? "", line: idx + 1 });
        } else {
          out.j150.push({ code, name, level, value: signed(fin.cents, fin.dc, "C") ?? 0, period: demo?.dtFin ?? "", line: idx + 1 });
        }
        count(reg); break;
      }
      default:
    }
  });
  if (!out.closings.length) out.warnings.push("Nenhum encerramento de resultado (I350/I355) encontrado.");
  if (!out.months.length) out.warnings.push("Nenhum saldo periódico (I150/I155) encontrado.");
  return out;
}
