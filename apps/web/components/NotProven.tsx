export function NotProven() {
  return (
    <section className="not-proven" aria-labelledby="nao-prova-titulo">
      <h2 id="nao-prova-titulo">O que o sandbox não prova</h2>
      <ul>
        <li>
          <strong>Pix de verdade.</strong> O BR Code não é pagável e o endToEndId começa com SANDBOX: não existe Pix de teste.
        </li>
        <li>
          <strong>Lightning.</strong> As invoices do sandbox têm o formato certo, mas não são pagáveis.
        </li>
        <li>
          <strong>Falhas e estornos.</strong> PAYOUT_FAILED, PAYOUT_REFUNDED e DEPOSIT_ASSET_REFUNDED não acontecem neste fluxo.
        </li>
        <li>
          <strong>MED.</strong> Contestações de Pix (DISPUTE_*) só existem com Pix real.
        </li>
        <li>
          <strong>Entrega de webhooks.</strong> O sandbox não envia webhooks para fora. A verificação de assinatura e a deduplicação estão no
          repositório, testadas com os payloads da documentação.
        </li>
        <li>
          <strong>Câmbio de mercado.</strong> O sandbox usa 1 USD = R$ 5,40 fixo; em produção a cotação varia.
        </li>
      </ul>
    </section>
  );
}
