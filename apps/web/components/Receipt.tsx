import type { RunView } from "@/lib/run/view";
import { verificationLabel } from "@/lib/ui/labels";
import { HashLink } from "./HashLink";

export function Receipt({ view }: { view: RunView }) {
  const confirmed = view.verifications.filter((v) => v.result === "confere").length;
  return (
    <section className="receipt" aria-labelledby="comprovante-titulo">
      <h2 id="comprovante-titulo">Comprovante</h2>
      <p className="muted">Cada linha põe lado a lado o que a API respondeu e o que a Base Sepolia registrou no evento Transfer da transação.</p>
      <table>
        <thead>
          <tr>
            <th scope="col">Operação</th>
            <th scope="col">API diz</th>
            <th scope="col">Blockchain diz</th>
            <th scope="col">Conferência</th>
            <th scope="col">Prova</th>
          </tr>
        </thead>
        <tbody>
          {view.verifications.map((v) => {
            const label = verificationLabel(v.result);
            return (
              <tr key={v.leg}>
                <th scope="row">{v.label}</th>
                <td data-label="API diz">
                  {v.apiSays.display}
                  {v.apiSays.expected && <span className="tag">esperado</span>}
                </td>
                <td data-label="Blockchain diz">{v.chainSays?.display ?? "—"}</td>
                <td data-label="Conferência">
                  <span data-testid="verification-result" className={`chip chip-${label.tone}`}>
                    {label.text}
                  </span>
                  {v.reason && <span className="reason">{v.reason}</span>}
                </td>
                <td data-label="Prova">
                  <HashLink hash={v.txHash} href={v.explorerUrl} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="summary">
        {confirmed} de {view.verifications.length} movimentos conferidos na Base Sepolia.
      </p>
      {view.verifications.some((v) => v.apiSays.expected) && (
        <p className="muted small">Esperado: no depósito o sandbox não informa o valor recebido, então a coluna da API mostra o valor pedido.</p>
      )}
    </section>
  );
}
