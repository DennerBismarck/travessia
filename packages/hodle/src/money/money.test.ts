import { describe, expect, it } from "vitest";
import {
  brlCentsToTokenRaw,
  centsToJsonNumber,
  convertToken,
  formatBrl,
  formatDecimal,
  formatToken,
  MoneyError,
  parseDecimal,
  tokenRawToBrlCents,
} from "./index";

const E18 = 10n ** 18n;

describe("parseDecimal", () => {
  it("converte strings da API em unidades brutas", () => {
    expect(parseDecimal("0.05", 6)).toBe(50_000n);
    expect(parseDecimal("54", 18)).toBe(54n * E18);
    expect(parseDecimal("0.54", 18)).toBe(54n * 10n ** 16n);
    expect(parseDecimal("27.00", 2)).toBe(2700n);
    expect(parseDecimal("0.00", 2)).toBe(0n);
  });

  it.each(["", "abc", "-1", "1e3", ".5", "1.", "1,5", " 1"])("recusa %j", (text) => {
    expect(() => parseDecimal(text, 6)).toThrow(MoneyError);
  });

  it("recusa casas decimais além do token", () => {
    expect(() => parseDecimal("0.1234567", 6)).toThrow(MoneyError);
  });
});

describe("formatDecimal", () => {
  it("faz o caminho inverso sem zeros à direita", () => {
    expect(formatDecimal(50_000n, 6)).toBe("0.05");
    expect(formatDecimal(54n * E18, 18)).toBe("54");
    expect(formatDecimal(10_000_000n, 6)).toBe("10");
    expect(formatDecimal(0n, 6)).toBe("0");
    expect(formatDecimal(-150n, 2)).toBe("-1.5");
  });
});

describe("conversões no câmbio fixo do sandbox", () => {
  it("BRL → token", () => {
    expect(brlCentsToTokenRaw(5400n, "BRLH")).toBe(54n * E18);
    expect(brlCentsToTokenRaw(2700n, "USDH")).toBe(5_000_000n);
    expect(brlCentsToTokenRaw(27n, "USDH")).toBe(50_000n); // sondagem: R$ 0,27 → 0.05 USDH
  });

  it("trunca, nunca arredonda para cima", () => {
    expect(brlCentsToTokenRaw(1n, "USDH")).toBe(1851n); // 0,01 / 5,4 = 0,0018518…
  });

  it("token → BRL", () => {
    expect(tokenRawToBrlCents(5_000_000n, "USDH")).toBe(2700n);
    expect(tokenRawToBrlCents(46n * 10n ** 16n, "BRLH")).toBe(46n);
  });

  it("troca BRLH ↔ USDH", () => {
    expect(convertToken(54n * E18, "BRLH", "USDH")).toBe(10_000_000n);
    expect(convertToken(54n * 10n ** 16n, "BRLH", "USDH")).toBe(100_000n); // sondagem: 0.54 → 0.1
    expect(convertToken(10_000_000n, "USDH", "BRLH")).toBe(54n * E18);
    expect(convertToken(7n, "USDH", "USDH")).toBe(7n);
  });
});

describe("formatação pt-BR", () => {
  it("formata reais", () => {
    expect(formatBrl(5400n)).toBe("R$ 54,00");
    expect(formatBrl(123_456n)).toBe("R$ 1.234,56");
    expect(formatBrl(0n)).toBe("R$ 0,00");
    expect(formatBrl(-150n)).toBe("-R$ 1,50");
  });

  it("formata tokens", () => {
    expect(formatToken(50_000n, "USDH")).toBe("0,05 USDH");
    expect(formatToken(54n * E18, "BRLH")).toBe("54 BRLH");
    expect(formatToken(1_234_500_000n, "USDH")).toBe("1.234,5 USDH");
  });
});

describe("centsToJsonNumber", () => {
  it("converte para o corpo JSON", () => {
    expect(centsToJsonNumber(5400n)).toBe(5400);
  });

  it("recusa negativos e valores fora do intervalo seguro", () => {
    expect(() => centsToJsonNumber(-1n)).toThrow(MoneyError);
    expect(() => centsToJsonNumber(2n ** 53n)).toThrow(MoneyError);
  });
});
