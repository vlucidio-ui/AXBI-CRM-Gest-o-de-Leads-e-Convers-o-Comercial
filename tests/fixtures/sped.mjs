// Gera escriturações SPED FICTÍCIAS (empresa inventada) para os testes do motor de diagnóstico.
// Nenhum dado real de cliente pode entrar neste repositório.
export const CNPJ = "11222333000181";
export const NOME = "EMPRESA FICTICIA DE TESTES LTDA";

const v = cents => (Math.abs(cents) / 100).toFixed(2).replace(".", ",");
const dc = (cents, positive) => (cents >= 0 ? positive : positive === "D" ? "C" : "D");

/**
 * ECF do Lucro Presumido com quatro trimestres. `q` = lista de 4 objetos:
 * { rb, ded, custos, outrasRec, despOp, prov, ac, disp, estoques, anc, pc, pnc, pl } em centavos
 * (ded, custos, despOp e prov positivos = valores a subtrair).
 */
export function ecf(year, q, { retificadora = "N", cnpj = CNPJ, ativoErrado = 0 } = {}) {
  const L = [`|0000|LECF|0011|${cnpj}|${NOME}|0|0|||0101${year}|3112${year}|${retificadora}||0||`];
  const ends = ["3103", "3006", "3009", "3112"], starts = ["0101", "0104", "0107", "0110"];
  q.forEach((t, i) => {
    L.push(`|P030|${starts[i]}${year}|${ends[i]}${year}|T0${i + 1}|`);
    const ativo = t.ac + t.anc + ativoErrado;
    const bp = [
      ["1", "ATIVO", "S", 1, "01", "", ativo, "D"],
      ["1.01", "ATIVO CIRCULANTE", "S", 2, "01", "1", t.ac, "D"],
      ["1.01.01", "DISPONIBILIDADES", "S", 3, "01", "1.01", t.disp, "D"],
      ["1.01.02", "CRÉDITOS", "S", 3, "01", "1.01", t.ac - t.disp - t.estoques, "D"],
      ["1.01.03", "ESTOQUES", "S", 3, "01", "1.01", t.estoques, "D"],
      ["1.02", "ATIVO NÃO CIRCULANTE", "S", 2, "01", "1", t.anc, "D"],
      ["2", "PASSIVO", "S", 1, "02", "", t.pc + t.pnc + t.pl, "C"],
      ["2.01", "PASSIVO CIRCULANTE", "S", 2, "02", "2", t.pc, "C"],
      ["2.02", "PASSIVO NÃO-CIRCULANTE", "S", 2, "02", "2", t.pnc, "C"],
      ["2.03", "PATRIMÔNIO LÍQUIDO", "S", 2, "03", "2", t.pl, "C"]
    ];
    for (const [cod, desc, tipo, niv, nat, sup, val, pos] of bp) {
      L.push(`|P100|${cod}|${desc}|${tipo}|${niv}|${nat}|${sup}|0,00|${pos}|${v(val)}|${v(val)}|${v(val)}|${dc(val, pos)}|`);
    }
    const rl = t.rb - t.ded, resOper = rl - t.custos + t.outrasRec - t.despOp, ll = resOper - t.prov;
    const dre = [
      ["3", "RESULTADO LÍQUIDO DO PERÍODO", "S", 1, "", ll],
      ["3.01", "RESULTADO LÍQUIDO DO PERÍODO ANTES DO IRPJ E DA CSLL - ATIVIDADE GERAL", "S", 2, "3", resOper],
      ["3.01.01", "RESULTADO OPERACIONAL", "S", 3, "3.01", resOper],
      ["3.01.01.01", "RECEITA LÍQUIDA", "S", 4, "3.01.01", rl],
      ["3.01.01.01.01", "RECEITA BRUTA", "S", 5, "3.01.01.01", t.rb],
      ["3.01.01.01.02", "(-) DEDUÇÕES DA RECEITA BRUTA", "S", 5, "3.01.01.01", -t.ded],
      ["3.01.01.03", "CUSTO DOS BENS E SERVIÇOS VENDIDOS", "S", 4, "3.01.01", -t.custos],
      ["3.01.01.05", "OUTRAS RECEITAS OPERACIONAIS", "S", 4, "3.01.01", t.outrasRec],
      ["3.01.01.07", "DESPESAS OPERACIONAIS", "S", 4, "3.01.01", -t.despOp],
      ["3.02", "PROVISÃO PARA IRPJ E CSLL", "S", 2, "3", -t.prov]
    ];
    for (const [cod, desc, tipo, niv, sup, val] of dre) L.push(`|P150|${cod}|${desc}|${tipo}|${niv}|04|${sup}|${v(val)}|${dc(val, "C")}|`);
  });
  L.push("|9999|" + (L.length + 1) + "|");
  return L.join("\r\n") + "\r\n";
}

/**
 * ECD com 12 meses, encerramento em 31/12, J100 e J150. `m` = 12 objetos { receita, deducoes, despesas }
 * (centavos, positivos). `bp` = { ativo, ac, pc, pl }.
 */
export function ecd(year, m, bp, { cnpj = CNPJ } = {}) {
  const L = [
    `|0000|LECD|0101${year}|3112${year}|${NOME}|${cnpj}|SP||3550308||0|0|1|0|||0|0||N|N|0|0|`,
    "|I010|G|9.00|",
    `|I050|0101${year}|04|S|1|3|| RESULTADO|`,
    `|I050|0101${year}|04|A|2|3101|3|RECEITA DE SERVICOS|`,
    `|I050|0101${year}|04|A|2|3201|3|IMPOSTOS SOBRE SERVICOS|`,
    `|I050|0101${year}|04|A|2|3301|3|DESPESAS GERAIS|`,
    `|I050|0101${year}|01|A|2|1101|1|BANCOS|`
  ];
  const mm = i => String(i + 1).padStart(2, "0");
  const last = i => String(new Date(year, i + 1, 0).getDate()).padStart(2, "0");
  const tot = { receita: 0, deducoes: 0, despesas: 0 };
  m.forEach((x, i) => {
    tot.receita += x.receita; tot.deducoes += x.deducoes; tot.despesas += x.despesas;
    const fecha = i === 11;
    L.push(`|I150|01${mm(i)}${year}|${last(i)}${mm(i)}${year}|`);
    // No mês de encerramento, o zeramento das contas entra no movimento (débito na receita etc.).
    L.push(`|I155|3101||0,00|C|${v(fecha ? tot.receita : 0)}|${v(x.receita)}|0,00|C|`);
    L.push(`|I155|3201||0,00|D|${v(x.deducoes)}|${v(fecha ? tot.deducoes : 0)}|0,00|D|`);
    L.push(`|I155|3301||0,00|D|${v(x.despesas)}|${v(fecha ? tot.despesas : 0)}|0,00|D|`);
    L.push(`|I155|1101||0,00|D|${v(x.receita)}|${v(x.deducoes + x.despesas)}|0,00|D|`);
  });
  const lucro = tot.receita - tot.deducoes - tot.despesas;
  L.push(`|I350|3112${year}|`, `|I355|3101||${v(tot.receita)}|C|`, `|I355|3201||${v(tot.deducoes)}|D|`, `|I355|3301||${v(tot.despesas)}|D|`);
  L.push(`|J005|0101${year}|3112${year}|1||`);
  L.push(`|J100|1|T|1||A|ATIVO|0,00|D|${v(bp.ativo)}|D||`);
  L.push(`|J100|1.01|T|2|1|A|ATIVO CIRCULANTE|0,00|D|${v(bp.ac)}|D||`);
  L.push(`|J100|2|T|1||P|PASSIVO|0,00|C|${v(bp.ativo)}|C||`);
  L.push(`|J100|2.01|T|2|2|P|PASSIVO CIRCULANTE|0,00|C|${v(bp.pc)}|C||`);
  L.push(`|J100|2.03|T|2|2|P|PATRIMONIO LIQUIDO|0,00|C|${v(bp.pl)}|C||`);
  L.push(`|J150|1|DRE1|T|1||RECEITA BRUTA|0,00|C|${v(tot.receita)}|C|R||`);
  L.push(`|J150|2|DRE2|T|1||DEDUCOES DA RECEITA BRUTA|0,00|D|${v(tot.deducoes)}|D|D||`);
  L.push(`|J150|3|DRE3|T|1||RECEITA LIQUIDA|0,00|C|${v(tot.receita - tot.deducoes)}|C|R||`);
  L.push(`|J150|4|DRE0|T|1||LUCRO LIQUIDO DO EXERCICIO|0,00|C|${v(lucro)}|${lucro >= 0 ? "C" : "D"}|R||`);
  return L.join("\r\n") + "\r\n";
}

const R = n => Math.round(n * 100);
/** Trimestre "saudável" de referência; `k` escala receita e custos. */
export const trimestre = (k = 1, over = {}) => ({
  rb: R(300000 * k), ded: R(15000 * k), custos: R(90000 * k), outrasRec: R(3000), despOp: R(60000), prov: R(20000 * k),
  ac: R(500000), disp: R(200000), estoques: R(50000), anc: R(300000), pc: R(250000), pnc: R(150000), pl: R(400000), ...over
});
/** Meses da ECD coerentes com 4 trimestres iguais a `trimestre(k)`: receita e deduções batem com a ECF. */
export const meses = (k = 1, over = {}) => Array.from({ length: 12 }, () => ({ receita: R(100000 * k), deducoes: R(5000 * k), despesas: R(55666.67 * k), ...over }));
