import type { CallRecord } from "@travessia/hodle/client";
import { PRODUCTION_NOTE, toCurl, toTypeScript } from "@/lib/ui/snippets";

export function CodeView({ request, response, idempotencyKey }: { request: CallRecord; response: unknown; idempotencyKey: string | null }) {
  return (
    <details className="code">
      <summary>Ver código</summary>
      {idempotencyKey && (
        <p className="small">
          Chave de idempotência: <code>{idempotencyKey}</code>
        </p>
      )}
      <h3 className="code-label">curl</h3>
      <pre>
        <code>{toCurl(request)}</code>
      </pre>
      <h3 className="code-label">TypeScript</h3>
      <pre>
        <code>{toTypeScript(request)}</code>
      </pre>
      <h3 className="code-label">Resposta da API</h3>
      <pre>
        <code>{JSON.stringify(response, null, 2)}</code>
      </pre>
      <p className="muted small">{PRODUCTION_NOTE}</p>
    </details>
  );
}
