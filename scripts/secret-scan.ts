// Falha o build se algo com formato de chave da Hodle aparecer na saída do Next.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const SECRET_PATTERN = /hodle_(?:test|live)_[A-Za-z0-9]{8,}/;

export function scanDir(dir: string): string[] {
  const hits: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "cache") walk(full);
        continue;
      }
      if (SECRET_PATTERN.test(readFileSync(full, "latin1"))) hits.push(full);
    }
  };
  walk(dir);
  return hits;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("uso: tsx scripts/secret-scan.ts <diretório>");
    process.exit(2);
  }
  const hits = scanDir(dir);
  if (hits.length > 0) {
    console.error(`secret-scan: chave encontrada em:\n${hits.join("\n")}`);
    process.exit(1);
  }
  console.log(`secret-scan: nenhum segredo em ${dir}`);
}
