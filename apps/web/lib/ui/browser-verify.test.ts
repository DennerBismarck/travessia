import { describe, expect, it } from "vitest";
import depositMint from "../../../../packages/hodle/src/chain/__fixtures__/deposit-mint.json";
import { checkLeg } from "./browser-verify";

const WALLET = "0x54444762e6648a233338D5a4109Eb9612af50bF9";
const ZERO = "0x0000000000000000000000000000000000000000";
const receipt = { status: depositMint.status as "success", logs: depositMint.logs };
const block = { blockNumber: 123n, timestamp: BigInt(Date.parse("2026-10-15T21:27:27Z") / 1000) };
const leg = {
  leg: "deposit_mint" as const,
  token: "BRLH" as const,
  apiSays: { raw: (10n ** 18n).toString(), display: "1 BRLH", expected: true },
  expectedFrom: ZERO,
  expectedTo: WALLET,
};

describe("checkLeg (conferência feita pelo navegador)", () => {
  it("confere e traz bloco, horário, origem, destino e valor", () => {
    const check = checkLeg(leg, { receipt, ...block });
    expect(check).toMatchObject({ leg: "deposit_mint", result: "confere", blockNumber: "123", time: "15/10/2026, 18:27", display: "1 BRLH", reason: null });
    expect(check.from).toBe(ZERO);
    expect(check.to?.toLowerCase()).toBe(WALLET.toLowerCase());
  });

  it("diverge quando o valor on-chain não bate com o da API", () => {
    const check = checkLeg({ ...leg, apiSays: { ...leg.apiSays, raw: (2n * 10n ** 18n).toString() } }, { receipt, ...block });
    expect(check).toMatchObject({ result: "diverge", reason: "valor diferente do informado pela API", display: "1 BRLH" });
  });

  it("sem recibo: ainda não conferido, com o motivo", () => {
    expect(checkLeg(leg, null, "RPC não respondeu")).toEqual({
      leg: "deposit_mint",
      result: "nao_conferido",
      blockNumber: null,
      time: null,
      from: null,
      to: null,
      display: null,
      reason: "RPC não respondeu",
    });
  });
});
