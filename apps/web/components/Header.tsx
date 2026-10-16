export function Header() {
  return (
    <header className="header">
      <p className="unofficial">Não oficial — construído sobre o sandbox da Hodle. Nenhum dinheiro real se move.</p>
      <h1 className="title">Travessia</h1>
      <p className="tagline">
        <span className="verb-pix">Receba em Pix,</span> <span className="verb-base">guarde em dólar,</span>{" "}
        <span>pague em stablecoin.</span>
      </p>
      <p className="lead">
        Um ciclo completo executado agora na API da Hodle. Cada movimento é conferido direto na Base Sepolia, e você pode
        conferir também.
      </p>
    </header>
  );
}
