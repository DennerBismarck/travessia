import type { CallRecord } from "@travessia/hodle/client";

export const PRODUCTION_NOTE =
  "Em produção: + walletPin e protectedSymmetricKey no saque, asset USDC/BRLA em vez de BRLH/USDH e address de destino no depósito.";

export function toCurl(request: CallRecord): string {
  const lines = [`curl --request ${request.method} \\`, `  --url ${request.url} \\`, '  --header "Authorization: Bearer $HODLE_API_KEY"'];
  if (request.body !== null && request.body !== undefined) {
    lines[lines.length - 1] += " \\";
    lines.push('  --header "Content-Type: application/json" \\', `  --data '${JSON.stringify(request.body)}'`);
  }
  return lines.join("\n");
}

export function toTypeScript(request: CallRecord): string {
  const hasBody = request.body !== null && request.body !== undefined;
  return [
    `const response = await fetch("${request.url}", {`,
    `  method: "${request.method}",`,
    "  headers: {",
    "    Authorization: `Bearer ${process.env.HODLE_API_KEY}`,",
    ...(hasBody ? ['    "Content-Type": "application/json",'] : []),
    "  },",
    ...(hasBody ? [`  body: JSON.stringify(${JSON.stringify(request.body, null, 2).replaceAll("\n", "\n  ")}),`] : []),
    "});",
    "const data = await response.json();",
  ].join("\n");
}
