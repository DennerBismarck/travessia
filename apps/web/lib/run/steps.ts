// Passos, atos e chaves de idempotência da execução padrão. Sem dependências: também roda no navegador.

export const STEP_ORDER = ["deposit", "settle", "deposit_confirm", "swap", "payout"] as const;
export type StepName = (typeof STEP_ORDER)[number];

export type Act = "receba" | "guarde" | "pague";
export const ACTS: readonly Act[] = ["receba", "guarde", "pague"];
export const STEP_ACT: Readonly<Record<StepName, Act>> = {
  deposit: "receba",
  settle: "receba",
  deposit_confirm: "receba",
  swap: "guarde",
  payout: "pague",
};

export type Leg = "deposit_mint" | "swap_debit" | "swap_credit" | "payout_debit";
export const LEG_ORDER: readonly Leg[] = ["deposit_mint", "swap_debit", "swap_credit", "payout_debit"];
export const LEG_LABEL: Readonly<Record<Leg, string>> = {
  deposit_mint: "Depósito: mint de BRLH",
  swap_debit: "Troca: débito de BRLH",
  swap_credit: "Troca: crédito de USDH",
  payout_debit: "Saque: débito de USDH",
};

/** Valores nominais da execução padrão (R$ 54,00 entram, R$ 27,00 saem por Pix). */
export const DEMO = { depositCents: 5400n, payoutCents: 2700n } as const;

const KEY_SUFFIX = { deposit: "dep", swap: "swap", payout: "pay" } as const;

export function idempotencyKey(runId: string, step: keyof typeof KEY_SUFFIX): string {
  return `trv-${runId}-${KEY_SUFFIX[step]}`;
}
