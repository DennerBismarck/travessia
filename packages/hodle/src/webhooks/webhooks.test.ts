import { describe, expect, it } from "vitest";
import { createEventLedger } from "./ledger";
import { signWebhook, verifySignature } from "./signature";

const SECRET = "a".repeat(64);
const BODY = JSON.stringify({ event: "PAYOUT_SUCCESSFUL", data: { transactionId: "65f1a8b2c3d4e5f6a7b8c9d0" } });
const NOW_MS = 1_792_000_000_000;
const TS = String(NOW_MS / 1000);

describe("verifySignature", () => {
  const signature = signWebhook({ rawBody: BODY, timestamp: TS, secret: SECRET });
  const base = { rawBody: BODY, signature, timestamp: TS, secret: SECRET, nowMs: NOW_MS };

  it("aceita assinatura válida", () => expect(verifySignature(base)).toBe(true));
  it("recusa corpo adulterado", () => expect(verifySignature({ ...base, rawBody: BODY.replace("65f1", "75f1") })).toBe(false));
  it("recusa segredo errado", () => expect(verifySignature({ ...base, secret: "b".repeat(64) })).toBe(false));
  it("recusa timestamp com mais de 300 s, para trás ou para frente", () => {
    expect(verifySignature({ ...base, nowMs: NOW_MS + 301_000 })).toBe(false);
    expect(verifySignature({ ...base, nowMs: NOW_MS - 301_000 })).toBe(false);
    expect(verifySignature({ ...base, nowMs: NOW_MS + 299_000 })).toBe(true);
  });
  it("recusa assinatura com tamanho errado ou não hex", () => {
    expect(verifySignature({ ...base, signature: signature.slice(0, 32) })).toBe(false);
    expect(verifySignature({ ...base, signature: "zz".repeat(32) })).toBe(false);
  });
  it("recusa timestamp não numérico", () => expect(verifySignature({ ...base, timestamp: "abc" })).toBe(false));
});

describe("createEventLedger", () => {
  const deposit = (event: string, eventId: string) => ({
    event,
    data: { eventId, trackId: "4b8e1f7a-2c3d-4e5f-8a9b-0c1d2e3f4a5b", externalId: "order-1", walletCharge: "wc-1" },
  });

  it("WEBHOOK_TEST é confirmado sem efeito", () => {
    const ledger = createEventLedger();
    expect(ledger.accept({ event: "WEBHOOK_TEST", data: {} }).action).toBe("ignored_test");
  });

  it("deduplica por data.eventId", () => {
    const ledger = createEventLedger();
    const event = deposit("DEPOSIT_ASSET_SUCCESS", "deposit-completed-66f0c1e2a4b5c6d7e8f90123");
    expect(ledger.accept(event).action).toBe("applied");
    expect(ledger.accept(event).action).toBe("duplicate");
  });

  it("payout sem eventId: deduplica por evento + transactionId", () => {
    const ledger = createEventLedger();
    const payout = { event: "PAYOUT_SUCCESSFUL", data: { transactionId: "65f1a8b2c3d4e5f6a7b8c9d0", externalId: "offramp:823e6356" } };
    expect(ledger.accept(payout)).toMatchObject({ action: "applied", dedupeKey: "PAYOUT_SUCCESSFUL:65f1a8b2c3d4e5f6a7b8c9d0" });
    expect(ledger.accept(payout).action).toBe("duplicate");
  });

  it("nunca regride: PIX_CONFIRMED depois de SUCCESS é stale", () => {
    const ledger = createEventLedger();
    ledger.accept(deposit("DEPOSIT_ASSET_SUCCESS", "deposit-completed-1"));
    expect(ledger.accept(deposit("DEPOSIT_PIX_CONFIRMED", "deposit-pix-confirmed-1")).action).toBe("stale");
    expect(ledger.stateOf("deposit:4b8e1f7a-2c3d-4e5f-8a9b-0c1d2e3f4a5b")).toBe("DEPOSIT_ASSET_SUCCESS");
  });

  it("estornos parciais com eventIds diferentes são aplicados", () => {
    const ledger = createEventLedger();
    ledger.accept(deposit("DEPOSIT_ASSET_SUCCESS", "deposit-completed-1"));
    expect(ledger.accept(deposit("DEPOSIT_ASSET_REFUNDED", "deposit-refund-1-A")).action).toBe("applied");
    expect(ledger.accept(deposit("DEPOSIT_ASSET_REFUNDED", "deposit-refund-1-B")).action).toBe("applied");
  });

  it("PAYOUT_REFUNDED deduplica por reversalTicketId", () => {
    const ledger = createEventLedger();
    const refund = { event: "PAYOUT_REFUNDED", data: { transactionId: "t1", reversalTicketId: "b1e4d9c7-2a55-4f83-91cd-77e0a1b2c3d4" } };
    expect(ledger.accept(refund).dedupeKey).toBe("PAYOUT_REFUNDED:b1e4d9c7-2a55-4f83-91cd-77e0a1b2c3d4");
    expect(ledger.accept(refund).action).toBe("duplicate");
  });

  it("disputa: criada e depois aceita, por endToEndId", () => {
    const ledger = createEventLedger();
    const e2e = "E00416968202608231253t7wOSElb8rU";
    expect(ledger.accept({ event: "DISPUTE_CREATED", data: { endToEndId: e2e } }).action).toBe("applied");
    expect(ledger.accept({ event: "DISPUTE_ACCEPTED", data: { endToEndId: e2e } }).action).toBe("applied");
    expect(ledger.accept({ event: "DISPUTE_CREATED", data: { endToEndId: e2e } }).action).toBe("duplicate");
  });

  it("payload sem evento é inválido", () => {
    expect(createEventLedger().accept({ data: {} }).action).toBe("invalid");
    expect(createEventLedger().accept(null).action).toBe("invalid");
  });
});
