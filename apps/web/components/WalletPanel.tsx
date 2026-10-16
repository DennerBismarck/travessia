import type { WalletView } from "@/lib/wallet";

export function WalletPanel({ wallet }: { wallet: WalletView | null }) {
  return (
    <section className="panel" aria-labelledby="carteira-titulo">
      <h2 id="carteira-titulo" className="panel-title">
        Carteira de teste na Base Sepolia
      </h2>
      {!wallet ? (
        <p className="muted">Lendo o saldo na blockchain…</p>
      ) : !wallet.address ? (
        <p className="muted">A carteira de teste é criada na primeira execução.</p>
      ) : (
        <>
          <a className="hash mono" href={wallet.explorerUrl ?? undefined} target="_blank" rel="noreferrer">
            {wallet.address}
          </a>
          <dl className="balances">
            <div>
              <dt>Real de teste</dt>
              <dd>{wallet.balances?.BRLH ?? "—"}</dd>
            </div>
            <div>
              <dt>Dólar de teste</dt>
              <dd>{wallet.balances?.USDH ?? "—"}</dd>
            </div>
          </dl>
          <p className="muted small">
            {wallet.error === "rpc" ? "RPC indisponível agora: saldo não lido." : "Saldo lido direto da blockchain (balanceOf), não da API."}
          </p>
        </>
      )}
    </section>
  );
}
