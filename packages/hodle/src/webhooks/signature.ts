import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** hex(HMAC_SHA256(secret, "<timestamp>.<rawBody>")), como em docs.hodle.com.br/docs/webhooks. */
export function signWebhook(args: { rawBody: string; timestamp: string; secret: string }): string {
  return createHmac("sha256", args.secret).update(`${args.timestamp}.${args.rawBody}`).digest("hex");
}

export function verifySignature(args: {
  rawBody: string;
  signature: string;
  timestamp: string;
  secret: string;
  nowMs?: number;
  toleranceSeconds?: number;
}): boolean {
  if (!/^\d+$/.test(args.timestamp)) return false;
  const tolerance = args.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  const age = Math.abs(Math.floor((args.nowMs ?? Date.now()) / 1000) - Number(args.timestamp));
  if (age > tolerance) return false;
  if (!/^[0-9a-f]+$/i.test(args.signature)) return false;
  const expected = createHmac("sha256", args.secret).update(`${args.timestamp}.${args.rawBody}`).digest();
  const received = Buffer.from(args.signature, "hex");
  if (received.length !== expected.length) return false;
  return timingSafeEqual(expected, received);
}
