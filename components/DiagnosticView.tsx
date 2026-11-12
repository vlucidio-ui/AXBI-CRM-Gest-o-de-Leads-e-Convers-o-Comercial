"use client";

import type { Diagnostic, Indicator, Semaforo } from "@/lib/diag/engine.mjs";
import { formatCnpj } from "@/lib/diag/workbook.mjs";

const money = (cents: number | null | undefined) => cents === null || cents === undefined ? "n/d"
  : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const moneyShort = (cents: number | null | undefined) => cents === null || cents === undefined ? "n/d"
  : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const percent = (v: number | null | undefined) => v === null || v === undefined ? "n/d"
  : (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
const index = (v: number | null | undefined) => v === null || v === undefined ? "n/d"
  : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const indicatorValue = (i: Indicator, v: number | null) => i.tipo === "moeda" ? money(v) : i.tipo === "percentual" ? percent(v) : index(v);
const SEM_LABEL: Record<string, string> = { verde: "Dentro da faixa", amarelo: "Atenção", vermelho: "Ação" };

function Light({ value }: { value: Semaforo }) {
  if (!value) return null;
  return <span className={`sem sem-${value}`}>{SEM_LABEL[value]}</span>;
}

/** Barras horizontais de um valor por ano (negativos em vermelho). */
function YearBars({ title, values, anos }: { title: string; values: Record<number, number | null>; anos: number[] }) {
  const max = Math.max(1, ...anos.map(y => Math.abs(values[y] ?? 0)));
  return (
    <div className="panel">
      <h3>{title}</h3>
      <div className="bars">
        {anos.map(y => {
          const v = values[y];
          return (
            <div className="bar-row diag-bar" key={y}>
              <span>{y}</span>
              <span className="bar-track"><span className={`bar-fill ${v !== null && v < 0 ? "neg" : ""}`} style={{ width: `${v === null ? 0 : (Math.abs(v) / max) * 100}%` }} /></span>
              <span className="bar-value">{moneyShort(v)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DiagnosticView({ diagnostic: d, draft }: { diagnostic: Diagnostic; draft: boolean }) {
  const anos = d.anos;
  const r = d.resumo;
  const row = (key: string) => d.dreAnual.find(l => l.chave === key)?.valores ?? {};
  const priorityClass = (p: string) => (p === "Alta" ? "pill pill-late" : p === "Média" ? "pill pill-today" : "pill");

  return (
    <div className="diag-report">
      {draft && <div className="alert error diag-draft" role="note">RASCUNHO — gerado automaticamente e ainda não aprovado por um profissional. Não entregar ao cliente.</div>}
      <header className="diag-head">
        <p className="muted small">AXBI Negócios Inteligentes · Diagnóstico das demonstrações contábeis</p>
        <h2>{d.empresa.nome || "Empresa não identificada"}</h2>
        <p className="muted">CNPJ {formatCnpj(d.empresa.cnpj) || "n/d"} · Exercícios {anos.join(", ") || "n/d"}{d.regime ? ` · Lucro ${d.regime}` : ""} · gerado em {d.geradoEm.slice(0, 10).split("-").reverse().join("/")} · {d.versao}</p>
      </header>

      {!r && <div className="alert error">Nenhuma ECF válida foi lida: sem DRE nem balanço para analisar. Veja os arquivos abaixo.</div>}

      {r && (
        <section className="kpis">
          <div className="kpi"><span>RECEITA LÍQUIDA {r.ano}</span><strong>{moneyShort(r.receitaLiquida)}</strong></div>
          <div className={`kpi ${r.lucroLiquido !== null && r.lucroLiquido < 0 ? "alert-kpi" : ""}`}><span>LUCRO LÍQUIDO {r.ano}</span><strong>{moneyShort(r.lucroLiquido)}</strong></div>
          <div className={`kpi ${r.varReceita !== null && r.varReceita < 0 ? "alert-kpi" : ""}`}><span>VARIAÇÃO DA RECEITA</span><strong>{percent(r.varReceita)}</strong></div>
          <div className="kpi"><span>MARGEM LÍQUIDA</span><strong>{percent(r.margemLiquida)}</strong></div>
          <div className={`kpi ${r.liquidezCorrente !== null && r.liquidezCorrente < 1 ? "alert-kpi" : ""}`}><span>LIQUIDEZ CORRENTE</span><strong>{index(r.liquidezCorrente)}</strong></div>
          <div className={`kpi ${r.achadosAltos ? "alert-kpi" : ""}`}><span>ACHADOS DE PRIORIDADE ALTA</span><strong>{r.achadosAltos}</strong></div>
        </section>
      )}

      {r && (
        <div className="diag-two">
          <YearBars title="Receita líquida por ano" values={row("rl")} anos={anos} />
          <YearBars title="Lucro líquido por ano" values={row("ll")} anos={anos} />
        </div>
      )}

      <section className="panel">
        <h3>1. Achados e riscos</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Prioridade</th><th>Área</th><th>Achado / evidência</th><th>Ação recomendada</th><th>Situação</th></tr></thead>
            <tbody>
              {d.achados.map(a => (
                <tr key={a.id}><td>{a.id}</td><td><span className={priorityClass(a.prioridade)}>{a.prioridade}</span></td><td>{a.area}</td><td>{a.achado}<br /><span className="muted small">Impacto: {a.impacto}</span></td><td>{a.acao}</td><td>{a.situacao}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {r && (
        <section className="panel">
          <h3>2. DRE anual</h3>
          <p className="muted small">Soma dos períodos de apuração da ECF. Deduções, custos e despesas aparecem negativos.</p>
          <div className="table-wrap">
            <table className="num">
              <thead><tr><th>Rubrica</th>{anos.map(y => <th key={y}>{y}</th>)}</tr></thead>
              <tbody>{d.dreAnual.map(l => <tr key={l.chave} className={["rl", "lb", "ll"].includes(l.chave) ? "strong-row" : ""}><td>{l.rotulo}</td>{anos.map(y => <td key={y}>{money(l.valores[y])}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </section>
      )}

      {d.dreTrimestral.length > 0 && (
        <section className="panel">
          <h3>3. Desempenho trimestral</h3>
          <div className="table-wrap">
            <table className="num">
              <thead><tr><th>Período</th><th>Receita bruta</th><th>Receita líquida</th><th>Lucro bruto</th><th>Lucro líquido</th><th>Margem líquida</th></tr></thead>
              <tbody>
                {d.dreTrimestral.map(t => {
                  const rl = t.rl as number | null, ll = t.ll as number | null;
                  return <tr key={`${t.ano}-${t.tri}`}><td>{t.tri}T/{t.ano}</td><td>{money(t.rb as number | null)}</td><td>{money(rl)}</td><td>{money(t.lb as number | null)}</td><td>{money(ll)}</td><td>{percent(rl && ll !== null ? ll / rl : null)}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {r && (
        <section className="panel">
          <h3>4. Balanço patrimonial</h3>
          <p className="muted small">Saldos finais do último período de apuração de cada ECF.</p>
          <div className="table-wrap">
            <table className="num">
              <thead><tr><th>Grupo</th>{anos.map(y => <th key={y}>{y}</th>)}</tr></thead>
              <tbody>{d.bpAnual.map(l => <tr key={l.chave} className={["ativo", "passivoTotal", "pl"].includes(l.chave) ? "strong-row" : ""}><td>{l.rotulo}</td>{anos.map(y => <td key={y}>{money(l.valores[y])}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </section>
      )}

      {r && (
        <section className="panel">
          <h3>5. Indicadores</h3>
          <p className="muted small">Faixas de referência AXBI: ponto de partida, variam por setor. “n/d” = dado não disponível nos arquivos.</p>
          <div className="table-wrap">
            <table className="num">
              <thead><tr><th>Indicador</th>{anos.map(y => <th key={y}>{y}</th>)}<th>Fórmula</th></tr></thead>
              <tbody>
                {d.indicadores.map(i => (
                  <tr key={i.chave}><td>{i.nome}</td>{anos.map(y => <td key={y}>{indicatorValue(i, i.valores[y].valor)} <Light value={i.valores[y].semaforo} /></td>)}<td className="muted small text">{i.formula}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {d.conciliacao.length > 0 && (
        <section className="panel">
          <h3>6. Conciliação ECD × ECF</h3>
          <p className="muted small">Diferença = ECF − ECD. Conciliado quando a diferença é de até R$ 0,01.</p>
          <div className="table-wrap">
            <table className="num">
              <thead><tr><th>Ano</th><th>Rubrica</th><th>ECD</th><th>ECF</th><th>Diferença</th><th>Situação</th></tr></thead>
              <tbody>
                {d.conciliacao.map(c => (
                  <tr key={`${c.ano}-${c.rubrica}`}><td>{c.ano}</td><td>{c.rubrica}</td><td>{money(c.ecd)}</td><td>{money(c.ecf)}</td><td>{money(c.diferenca)}</td>
                    <td><span className={c.situacao === "Divergência" ? "pill pill-late" : "pill"}>{c.situacao}</span></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {d.planoAcao.length > 0 && (
        <section className="panel">
          <h3>7. Plano de ação</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Prazo</th><th>Prioridade</th><th>Atividade</th><th>Origem</th></tr></thead>
              <tbody>{d.planoAcao.map(p => <tr key={p.ordem}><td>{p.ordem}</td><td>{p.prazo}</td><td><span className={priorityClass(p.prioridade)}>{p.prioridade}</span></td><td>{p.atividade}</td><td>{p.origem} · {p.area}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel">
        <h3>8. Arquivos analisados</h3>
        <p className="muted small">O SHA-256 identifica exatamente o arquivo lido. Os arquivos ficam no seu computador: o CRM guarda só o resultado.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Tipo</th><th>Ano</th><th>Arquivo</th><th>Usado</th><th>SHA-256</th></tr></thead>
            <tbody>{d.fontes.map(f => <tr key={f.arquivo + f.sha256}><td>{f.tipo}</td><td>{f.ano || "—"}</td><td>{f.arquivo}</td><td>{f.usado ? "sim" : "não"}</td><td className="mono small">{f.sha256 || "—"}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h3>9. Método e limites</h3>
        <ul className="diag-limits">{d.limites.map(l => <li key={l}>{l}</li>)}</ul>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Item</th><th>Fórmula</th><th>Fonte</th><th>Validação / restrição</th></tr></thead>
            <tbody>{d.metodologia.map(m => <tr key={m.indicador}><td>{m.indicador}</td><td>{m.formula}</td><td>{m.fonte}</td><td>{m.validacao}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
