import { describe, expect, it } from "vitest";
import { createRunLock } from "./lock";

function setup() {
  const expired: string[] = [];
  const lock = createRunLock({ onExpire: (id) => expired.push(id) });
  return { lock, expired };
}

describe("trava global", () => {
  it("uma execução por vez", () => {
    const { lock } = setup();
    expect(lock.acquire("a", 0)).toEqual({ ok: true });
    expect(lock.acquire("b", 1_000)).toEqual({ ok: false, holder: "a", retryAfterSec: 15 });
    expect(lock.holds("a", 1_000)).toBe(true);
    expect(lock.holds("b", 1_000)).toBe(false);
  });

  it("lease vence 45 s depois do fim do último passo", () => {
    const { lock, expired } = setup();
    lock.acquire("a", 0);
    lock.tryBeginStep("a");
    lock.endStep("a", 10_000);
    expect(lock.current(55_000)).toBe("a");
    expect(lock.current(55_001)).toBeNull();
    expect(expired).toEqual(["a"]);
    expect(lock.acquire("b", 55_001)).toEqual({ ok: true });
  });

  it("nunca vence com passo em andamento, mesmo depois de 60 s", () => {
    const { lock, expired } = setup();
    lock.acquire("a", 0);
    lock.tryBeginStep("a");
    expect(lock.acquire("b", 60_000).ok).toBe(false);
    lock.endStep("a", 60_000);
    expect(lock.acquire("b", 104_000).ok).toBe(false);
    expect(lock.acquire("b", 105_001).ok).toBe(true);
    expect(expired).toEqual(["a"]);
  });

  it("um passo por vez dentro da mesma execução", () => {
    const { lock } = setup();
    lock.acquire("a", 0);
    expect(lock.tryBeginStep("a")).toBe(true);
    expect(lock.tryBeginStep("a")).toBe(false);
    lock.endStep("a", 1_000);
    expect(lock.tryBeginStep("a")).toBe(true);
    expect(lock.tryBeginStep("b")).toBe(false);
  });

  it("release libera só para quem segura", () => {
    const { lock } = setup();
    lock.acquire("a", 0);
    lock.release("b");
    expect(lock.current(1)).toBe("a");
    lock.release("a");
    expect(lock.current(1)).toBeNull();
  });
});
