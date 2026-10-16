import type { Metadata } from "next";
import { AutoRefresh } from "@/components/AutoRefresh";
import { HashLink } from "@/components/HashLink";
import { LatencyBars } from "@/components/LatencyBars";
import { SiteFooter } from "@/components/SiteFooter";
import { getServices } from "@/lib/services";
import { formatDateTimeBr, formatSeconds, runStatusLabel, verificationLabel } from "@/lib/ui/labels";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Painel ao vivo — Travessia",
  description: "Tudo o que passou pela Travessia no sandbox da Hodle: execuções, conferências on-chain e latência de cada passo da API.",
};

export default async function PainelPage() {
  const d = await getServices().dashboard.read();
  return (
    <main className="page">
      <header className="header">
        <p className="unofficial">Não oficial — construído sobre o sandbox da Hodle. Nenhum dinheiro real se move.</p>
        <p className="small">
          <a href="/">← Travessia</a>
        </p>
        <h1 className="title">Painel ao vivo</h1>
        <p className="lead">Tudo o que passou pela Travessia, lido do próprio banco: execuções, conferências na Base Sepolia e o tempo de cada chamada à API.</p>
        <AutoRefresh generatedAt={d.generatedAt} />
      </header>

      <section className="panel" aria-labelledby="numeros-titulo">
        <h2 id="numeros-titulo" className="panel-title">
          Números
        </h2>
        <dl className="figures">
          <div>
            <dt>Execuções</dt>
            <dd data-testid="dash-runs-total">{d.runs.total}</dd>
          </div>
          <div>
            <dt>Concluídas</dt>
            <dd>
              {d.runs.completed}
              {d.runs.completedPct !== null && <span className="figure-note"> · {d.runs.completedPct}%</span>}
            </dd>
          </div>
          <div>
            <dt>Movimentos conferidos</dt>
            <dd>
              {d.verifications.confere} de {d.verifications.total}
              {d.verifications.conferePct !== null && <span className="figure-note"> · {d.verifications.conferePct}%</span>}
            </dd>
          </div>
          <div>
            <dt>Entrou por Pix</dt>
            <dd>{d.volume.display.in}</dd>
          </div>
          <div>
            <dt>Saiu por Pix</dt>
            <dd>{d.volume.display.pixOut}</dd>
          </div>
        </dl>
        <p className="muted small">Pix simulado pelo sandbox; os movimentos on-chain são reais, na Base Sepolia.</p>
      </section>

      <section className="dash-section" aria-labelledby="latencia-titulo">
        <h2 id="latencia-titulo">Tempo de cada passo</h2>
        <p className="muted small">Tempo da resposta da API em cada chamada concluída. A barra é a mediana; o traço é o p95.</p>
        <LatencyBars rows={d.latency} />
      </section>

      <section className="dash-section" aria-labelledby="execucoes-titulo">
        <h2 id="execucoes-titulo">Últimas execuções</h2>
        {d.recentRuns.length === 0 ? (
          <p className="muted">Nenhuma execução ainda.</p>
        ) : (
          <table className="dash-table">
            <thead>
              <tr>
                <th scope="col">Execução</th>
                <th scope="col">Status</th>
                <th scope="col">Duração</th>
                <th scope="col">Conferidos</th>
                <th scope="col">Quando</th>
              </tr>
            </thead>
            <tbody>
              {d.recentRuns.map((r) => {
                const label = runStatusLabel(r.status);
                return (
                  <tr key={r.id}>
                    <td>
                      <a className="mono" href={`/r/${r.id}`} data-testid="dash-run-link">
                        {r.id}
                      </a>
                    </td>
                    <td>
                      <span className={`chip chip-${label.tone}`}>{label.text}</span>
                    </td>
                    <td>{r.durationMs === null ? "—" : formatSeconds(r.durationMs)}</td>
                    <td>
                      {r.confere}/{r.legs}
                    </td>
                    <td>{formatDateTimeBr(r.startedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="dash-section" aria-labelledby="transacoes-titulo">
        <h2 id="transacoes-titulo">Últimas transações on-chain</h2>
        {d.recentTransfers.length === 0 ? (
          <p className="muted">Nenhuma transação conferida ainda.</p>
        ) : (
          <ul className="dash-transfers">
            {d.recentTransfers.map((t) => {
              const label = verificationLabel(t.result as "confere" | "diverge" | "nao_conferido");
              return (
                <li key={`${t.runId}-${t.leg}`}>
                  <div>
                    <strong>{t.label}</strong> · {t.display} · <span className={`chip chip-${label.tone}`}>{label.text}</span> ·{" "}
                    <a href={`/r/${t.runId}`}>execução {t.runId}</a>
                  </div>
                  <HashLink hash={t.txHash} href={t.explorerUrl} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <SiteFooter />
    </main>
  );
}
