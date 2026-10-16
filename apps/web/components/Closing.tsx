import type { ClosingView } from "@/lib/run/view";

export function Closing({ closing }: { closing: ClosingView }) {
  return (
    <section className="closing" data-testid="closing" aria-labelledby="fechamento-titulo">
      <h2 id="fechamento-titulo">Fechamento</h2>
      <p className="equation">
        <span>
          entrou <strong>{closing.display.in}</strong>
        </span>
        <span>=</span>
        <span>
          saiu por Pix <strong>{closing.display.pixOut}</strong>
        </span>
        <span>+</span>
        <span>
          guardado <strong>{closing.display.kept}</strong>
        </span>
        <span>+</span>
        <span>
          taxas <strong>{closing.display.fees}</strong>
        </span>
      </p>
      <p className={closing.balanced ? "verdict-ok" : "verdict-fail"}>
        {closing.balanced ? "Fecha no centavo." : "Não fecha: confira as linhas do comprovante."}
      </p>
      <p className="muted small">
        Calculado em inteiros a partir das respostas da API, não fixo no código. O guardado está avaliado no câmbio fixo do sandbox (1 USD = R$ 5,40).
      </p>
    </section>
  );
}
