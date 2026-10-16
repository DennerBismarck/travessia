export const REDACTED = "[REDACTED]";

const SECRET_FIELDS = new Set(["walletpin", "protectedsymmetrickey", "apikey"]);

/** Cópia profunda sem segredos: campos sensíveis viram [REDACTED] e qualquer ocorrência de um segredo conhecido é mascarada. */
export function redact<T>(value: T, secrets: readonly string[]): T {
  const active = secrets.filter((secret) => secret.length >= 4);
  const walk = (current: unknown, key?: string): unknown => {
    if (key !== undefined && SECRET_FIELDS.has(key.toLowerCase())) return current == null ? current : REDACTED;
    if (typeof current === "string") return active.reduce((text, secret) => text.split(secret).join(REDACTED), current);
    if (Array.isArray(current)) return current.map((item) => walk(item));
    if (current !== null && typeof current === "object") {
      return Object.fromEntries(Object.entries(current).map(([k, v]) => [k, walk(v, k)]));
    }
    return current;
  };
  return walk(value) as T;
}
