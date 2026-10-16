"use client";

import { useState } from "react";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import type { VerificationView } from "@/lib/run/view";
import { checkLeg, PUBLIC_RPC_URLS, type BrowserCheck } from "@/lib/ui/browser-verify";
import { verificationLabel } from "@/lib/ui/labels";

type Phase = "idle" | "running" | "done";

async function checkAll(verifications: VerificationView[], rpcUrl: string): Promise<BrowserCheck[]> {
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl, { timeout: 8_000, retryCount: 1 }) });
  return Promise.all(
    verifications.map(async (v) => {
      const receipt = await client.getTransactionReceipt({ hash: v.txHash as `0x${string}` });
      const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      return checkLeg(v, {
        receipt: { status: receipt.status, logs: receipt.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data })) },
        blockNumber: receipt.blockNumber,
        timestamp: block.timestamp,
      });
    }),
  );
}

export function BrowserVerify({ verifications }: { verifications: VerificationView[] }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [checks, setChecks] = useState<BrowserCheck[]>([]);
  const [rpcUsed, setRpcUsed] = useState<string | null>(null);

  async function run() {
    setPhase("running");
    for (const url of PUBLIC_RPC_URLS) {
      try {
        setChecks(await checkAll(verifications, url));
        setRpcUsed(url);
        setPhase("done");
        return;
      } catch {
        // tenta a próxima RPC pública
      }
    }
    setChecks(verifications.map((v) => checkLeg(v, null, "nenhuma RPC pública respondeu agora")));
    setRpcUsed(null);
    setPhase("done");
  }

  const confirmed = checks.filter((c) => c.result === "confere").length;
  return (
    <div className="browser-verify">
      <button type="button" className="secondary" onClick={run} disabled={phase === "running"}>
        Conferir pelo meu navegador
      </button>
      <p className="muted small">
        Não precisa confiar nesta página: seu navegador lê cada transação direto numa RPC pública da Base Sepolia e refaz a conta.
      </p>
      {phase === "running" && (
        <p className="small" role="status">
          Consultando a Base Sepolia…
        </p>
      )}
      {phase === "done" && (
        <div role="status">
          <ul className="browser-checks">
            {checks.map((c) => {
              const v = verifications.find((x) => x.leg === c.leg);
              const tone = verificationLabel(c.result).tone;
              return (
                <li key={c.leg} data-testid="browser-check">
                  <span className={`chip chip-${tone}`}>{c.result === "confere" ? "confirmado pelo seu navegador" : verificationLabel(c.result).text}</span>{" "}
                  <strong>{v?.label}</strong>
                  {c.blockNumber ? (
                    <span className="small">
                      {" "}
                      · bloco {c.blockNumber} · {c.time} · {c.display}
                      <br />
                      <span className="hash mono">{c.from}</span> → <span className="hash mono">{c.to}</span>
                    </span>
                  ) : (
                    <span className="small"> · {c.reason}</span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="small">
            {confirmed} de {checks.length} confirmados. {rpcUsed ? <>RPC consultada: <code>{rpcUsed}</code>. </> : null}
            Nada disso passou pelo servidor da Travessia.
          </p>
        </div>
      )}
    </div>
  );
}
