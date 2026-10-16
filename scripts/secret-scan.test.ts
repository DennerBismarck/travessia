import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanDir } from "./secret-scan";

function fixtureDir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "scan-"));
  for (const [relative, content] of Object.entries(files)) {
    const full = join(root, relative);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

describe("scanDir", () => {
  it("aponta arquivo com string no formato de chave", () => {
    const dir = fixtureDir({ "static/chunks/a.js": 'const k="hodle_test_abcDEF123456"' });
    expect(scanDir(dir)).toEqual([join(dir, "static/chunks/a.js")]);
  });

  it("aceita o prefixo puro usado em textos e checagens", () => {
    const dir = fixtureDir({ "static/b.js": 'label("chave hodle_test_ do sandbox")' });
    expect(scanDir(dir)).toEqual([]);
  });

  it("ignora o cache de build", () => {
    const dir = fixtureDir({ "cache/x.pack": "hodle_live_abcDEF123456" });
    expect(scanDir(dir)).toEqual([]);
  });

  it("falha se o diretório não existe", () => {
    expect(() => scanDir("/caminho/que/nao/existe")).toThrow();
  });
});
