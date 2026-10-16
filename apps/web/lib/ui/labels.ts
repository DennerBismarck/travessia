import type { Act, StepName } from "../run/steps";
import type { RunStatus } from "../store/store";
import type { RunView, StepView, VerificationView } from "../run/view";

export type Tone = "neutral" | "ok" | "warn" | "fail";

export const ACT_COPY: Readonly<Record<Act, { title: string; lead: string }>> = {
  receba: { title: "Receba em Pix", lead: "R$ 54,00 entram por Pix e viram BRLH na carteira de teste." },
  guarde: { title: "Guarde em dólar", lead: "O BRLH vira USDH no câmbio fixo do sandbox." },
  pague: { title: "Pague em stablecoin", lead: "USDH paga um Pix de R$ 27,00." },
};

export const STEP_COPY: Readonly<Record<StepName, { title: string; doing: string; call: string; explain: string }>> = {
  deposit: {
    title: "Cobrança Pix criada",
    doing: "criando a cobrança Pix",
    call: "POST /api/deposit/asset",
    explain: "Pede um BR Code de R$ 54,00 que, pago, vira BRLH na carteira de teste. No sandbox o código não é pagável.",
  },
  settle: {
    title: "Chegada do Pix simulada",
    doing: "simulando a chegada do Pix",
    call: "POST /avenia/webhook",
    explain: "Não existe Pix de teste: este é o mesmo webhook que o provedor envia quando o Pix cai, autenticado pela chave do sandbox.",
  },
  deposit_confirm: {
    title: "Depósito confirmado",
    doing: "confirmando o depósito",
    call: "GET /api/deposit/{trackId}",
    explain: "Consulta o depósito até COMPLETED e pega o hash do mint de BRLH na Base Sepolia.",
  },
  swap: {
    title: "Troca para dólar",
    doing: "trocando BRLH por USDH",
    call: "POST /api/wallet/swap",
    explain: "Sai BRLH, entra USDH, a 1 USD = R$ 5,40. As duas pernas são transações reais.",
  },
  payout: {
    title: "Pagamento por Pix",
    doing: "pagando o Pix",
    call: "POST /api/wallet/payout",
    explain: "Paga R$ 27,00 para uma chave Pix fixa e fictícia. O débito de USDH é real; o Pix é simulado.",
  },
};

const ERROR_COPY: Readonly<Record<string, string>> = {
  SANDBOX_INSUFFICIENT_BALANCE: "A carteira de teste não tem saldo suficiente para esta operação.",
  SANDBOX_SWAP_REFUNDED: "O crédito falhou e o valor debitado voltou para a carteira.",
  SANDBOX_SETTLEMENT_FAILED: "Uma etapa on-chain falhou ou ficou sem recibo em 60 s.",
  SANDBOX_SWAP_IN_PROGRESS: "A troca com esta chave ainda está em andamento.",
  TIMEOUT: "A API não respondeu a tempo. A operação pode ter sido aceita: a próxima tentativa usa a mesma chave.",
  NETWORK_ERROR: "Falha de rede ao falar com a API.",
  INVALID_RESPONSE: "A resposta veio num formato inesperado.",
  DEPOSIT_NOT_CONFIRMED: "O depósito continuou sem confirmação por 10 s.",
  MAX_ATTEMPTS: "Este passo foi tentado 4 vezes sem resultado conclusivo.",
  NOT_SETTLED: "O webhook foi recebido, mas o depósito não foi liquidado.",
  MISSING_TX_HASH: "A API não devolveu o hash da transação.",
  UNEXPECTED_RESPONSE: "A resposta não trazia os campos necessários.",
};

export function explainError(code: string | null): string {
  const known = code ? ERROR_COPY[code] : undefined;
  if (known) return known;
  const status = code?.match(/^(?:PAYOUT|SWAP|DEPOSIT)_(.+)$/)?.[1];
  return status ? `A API devolveu o status ${status}.` : "Erro devolvido pela API.";
}

export function stepStatusLabel(step: StepView): { text: string; tone: Tone } {
  switch (step.status) {
    case "pending":
      return { text: "na fila", tone: "neutral" };
    case "sent":
      return { text: "enviado, aguardando resposta", tone: "neutral" };
    case "ok":
      return { text: step.apiStatus ?? `HTTP ${step.httpStatus}`, tone: "ok" };
    case "failed":
      return { text: step.errorCode ?? "falhou", tone: "fail" };
    case "unknown":
      return step.httpStatus === 429
        ? { text: "limite de requisições: aguardando para repetir", tone: "warn" }
        : { text: "resultado incerto: conferindo antes de repetir", tone: "warn" };
  }
}

export function verificationLabel(result: VerificationView["result"]): { text: string; tone: Tone } {
  if (result === "confere") return { text: "confere", tone: "ok" };
  if (result === "diverge") return { text: "diverge", tone: "fail" };
  return { text: "ainda não conferido", tone: "warn" };
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

const PROGRESS: Readonly<Record<StepName, number>> = { deposit: 8, settle: 12, deposit_confirm: 21, swap: 50, payout: 100 };

export function railProgress(view: RunView | null): number {
  if (!view) return 0;
  return view.steps.reduce((progress, s) => (s.status === "ok" ? PROGRESS[s.name] : progress), 0);
}

export function runStatusText(phase: "idle" | "running" | "done", view: RunView | null): string {
  if (phase === "idle" || !view) return "Leva uns 15 segundos. Você não digita nada: a chave Pix de destino é fixa e fictícia.";
  if (phase === "running" || view.status === "running") {
    const current = view.steps.find((s) => s.status !== "ok");
    return current ? `Executando: ${STEP_COPY[current.name].doing}…` : "Executando…";
  }
  if (view.status === "completed") return `Travessia concluída em ${formatSeconds(view.durationMs ?? 0)}.`;
  if (view.status === "failed") return "A travessia parou num erro. O passo em vermelho mostra o código exato devolvido pela API.";
  return "A travessia foi interrompida antes de terminar.";
}

export function unavailableText(reason: string): string {
  if (reason === "kill_switch") return "As execuções estão pausadas no momento.";
  if (reason === "daily_cap") return "O limite diário de execuções foi atingido. Volte amanhã.";
  return "Não foi possível iniciar agora.";
}

export function formatDateTimeBr(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(iso));
}

export function runStatusLabel(status: RunStatus): { text: string; tone: Tone } {
  if (status === "completed") return { text: "concluída", tone: "ok" };
  if (status === "failed") return { text: "falhou", tone: "fail" };
  if (status === "interrupted") return { text: "interrompida", tone: "warn" };
  return { text: "em andamento", tone: "neutral" };
}
