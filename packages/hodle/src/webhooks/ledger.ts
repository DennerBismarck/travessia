// Livro de eventos: deduplica entregas "at least once" e nunca regride o estado de um pedido.

export type LedgerAction = "applied" | "duplicate" | "ignored_test" | "stale" | "invalid";

export interface LedgerOutcome {
  action: LedgerAction;
  event: string | null;
  dedupeKey: string | null;
  orderKey: string | null;
  state: string | null;
}

type Data = Record<string, unknown>;

const RANK: Readonly<Record<string, number>> = {
  DEPOSIT_PIX_CONFIRMED: 1,
  DEPOSIT_ASSET_SUCCESS: 2,
  DEPOSIT_ASSET_FAILED: 2,
  DEPOSIT_ASSET_REFUNDED: 3,
  PAYOUT_SUCCESSFUL: 2,
  PAYOUT_FAILED: 2,
  PAYOUT_REFUNDED: 3,
  DISPUTE_CREATED: 1,
  DISPUTE_ACCEPTED: 2,
  DISPUTE_REJECTED: 2,
  DISPUTE_CANCELED: 2,
};

const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

export function dedupeKeyOf(event: string, data: Data): string | null {
  const eventId = text(data.eventId);
  if (eventId) return eventId;
  if (event === "PAYOUT_REFUNDED") {
    const reversal = text(data.reversalTicketId) ?? text(data.refundTxId);
    if (reversal) return `${event}:${reversal}`;
  }
  if (event.startsWith("DISPUTE_")) {
    const endToEndId = text(data.endToEndId);
    if (endToEndId) return `${event}:${endToEndId}`;
  }
  const id = text(data.transactionId) ?? text(data.externalId) ?? text(data.trackId) ?? text(data.walletCharge);
  return id ? `${event}:${id}` : null;
}

export function orderKeyOf(event: string, data: Data): string | null {
  if (event.startsWith("DEPOSIT_")) {
    const id = text(data.trackId) ?? text(data.walletCharge) ?? text(data.externalId);
    return id ? `deposit:${id}` : null;
  }
  if (event.startsWith("PAYOUT_")) {
    const id = text(data.transactionId) ?? text(data.externalId);
    return id ? `payout:${id}` : null;
  }
  if (event.startsWith("DISPUTE_")) {
    const id = text(data.endToEndId);
    return id ? `dispute:${id}` : null;
  }
  return null;
}

export function createEventLedger() {
  const seen = new Set<string>();
  const states = new Map<string, string>();

  return {
    accept(payload: unknown): LedgerOutcome {
      const envelope = (payload ?? {}) as { event?: unknown; data?: unknown };
      const event = text(envelope.event);
      if (!event) return { action: "invalid", event: null, dedupeKey: null, orderKey: null, state: null };
      if (event === "WEBHOOK_TEST") return { action: "ignored_test", event, dedupeKey: null, orderKey: null, state: null };

      const data = (envelope.data !== null && typeof envelope.data === "object" ? envelope.data : {}) as Data;
      const dedupeKey = dedupeKeyOf(event, data);
      const orderKey = orderKeyOf(event, data);
      const current = orderKey ? (states.get(orderKey) ?? null) : null;

      if (dedupeKey && seen.has(dedupeKey)) return { action: "duplicate", event, dedupeKey, orderKey, state: current };
      if (dedupeKey) seen.add(dedupeKey);
      if (!orderKey) return { action: "applied", event, dedupeKey, orderKey, state: null };

      const currentRank = current ? (RANK[current] ?? 0) : 0;
      const nextRank = RANK[event] ?? 0;
      if (current && (nextRank < currentRank || (nextRank === currentRank && current !== event))) {
        return { action: "stale", event, dedupeKey, orderKey, state: current };
      }
      states.set(orderKey, event);
      return { action: "applied", event, dedupeKey, orderKey, state: event };
    },
    stateOf: (orderKey: string): string | undefined => states.get(orderKey),
  };
}
