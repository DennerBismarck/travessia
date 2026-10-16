"use client";

import { useState } from "react";
import type { ReplayBody } from "@/lib/http";
import type { PayoutSummary, ReplayView } from "@/lib/run/view";

export function ReplayProof({ runId, first, initial }: { runId: string; first: PayoutSummary; initial: ReplayView[] }) {
  const [replays, setReplays] = useState(initial);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function replay() {
    setSending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/runs/${runId}/replay-payout`, { method: "POST" });
      const body = (await response.json()) as ReplayBody;
      if ("view" in body) setReplays(body.view.replays);
      else setMessage("reason" in body ? body.reason : "message" in body ? body.message : `HTTP ${response.status}`);
    } catch {
      setMessage("Falha de rede ao repetir o saque.");
    } finally {
      setSending(false);
    }
  }

  const last = replays.at(-1);
  return (
    <section className="replay" aria-labelledby="replay-titulo">
      <h2 id="replay-titulo">Prova de idempotência</h2>
      <p>
        Repete o saque com o mesmo <code>externalId</code>. Uma API idempotente devolve o mesmo pagamento, sem mover dinheiro de novo.
      </p>
      <button type="button" className="secondary" onClick={replay} disabled={sending}>
        Pagar de novo (mesma chave)
      </button>
      {message && (
        <p className="notice" role="alert">
          {message}
        </p>
      )}
      {last && (
        <div data-testid="replay-result">
          <table className="compare">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Campo</span>
                </th>
                <th scope="col">1ª resposta</th>
                <th scope="col">Repetição</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">transactionId</th>
                <td className="mono">{first.transactionId}</td>
                <td className="mono">{last.second?.transactionId ?? "—"}</td>
              </tr>
              <tr>
                <th scope="row">txHash</th>
                <td className="mono">{first.txHash ?? "—"}</td>
                <td className="mono">{last.second?.txHash ?? "—"}</td>
              </tr>
            </tbody>
          </table>
          <p className={last.sameTransaction ? "verdict-ok" : "verdict-fail"}>
            {last.sameTransaction ? "Mesmo transactionId e mesmo txHash: nenhuma transação nova." : "As respostas diferem: confira os hashes."}
          </p>
        </div>
      )}
    </section>
  );
}
