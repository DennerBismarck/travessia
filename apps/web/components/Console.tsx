"use client";

import { useCallback, useEffect, useState } from "react";
import type { HealthView } from "@/lib/health";
import type { RunView } from "@/lib/run/view";
import { driveRun } from "@/lib/ui/driver";
import { railProgress, runStatusText, unavailableText } from "@/lib/ui/labels";
import type { WalletView } from "@/lib/wallet";
import { Acts } from "./Acts";
import { Closing } from "./Closing";
import { Rail } from "./Rail";
import { Receipt } from "./Receipt";
import { ReplayProof } from "./ReplayProof";
import { RunLinks } from "./RunLinks";
import { WalletPanel } from "./WalletPanel";

type Phase = "idle" | "running" | "done";

async function post(path: string) {
  const response = await fetch(path, { method: "POST" });
  return { status: response.status, body: (await response.json().catch(() => null)) as unknown };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function Console() {
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [view, setView] = useState<RunView | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [fallback, setFallback] = useState<{ text: string; runId: string | null } | null>(null);
  // O botão só habilita depois da hidratação: antes disso um clique não teria efeito.
  const [hydrated, setHydrated] = useState(false);

  const loadWallet = useCallback(async () => {
    try {
      const response = await fetch("/api/wallet", { cache: "no-store" });
      setWallet((await response.json()) as WalletView);
    } catch {
      // o painel continua em "lendo o saldo"
    }
  }, []);

  useEffect(() => {
    setHydrated(true);
    void loadWallet();
    fetch("/api/health", { cache: "no-store" })
      .then((response) => response.json() as Promise<HealthView>)
      .then((health) => {
        if (!health.sandbox) setFallback({ text: "O sandbox da Hodle não respondeu agora.", runId: health.lastCompletedRunId });
      })
      .catch(() => undefined);
  }, [loadWallet]);

  async function run() {
    setPhase("running");
    setView(null);
    setNotice(null);
    setFallback(null);
    const outcome = await driveRun({ post, sleep: wait, onView: setView, onNotice: setNotice });
    setPhase(outcome.kind === "unavailable" ? "idle" : "done");
    if (outcome.kind === "finished") setView(outcome.view);
    if (outcome.kind === "unavailable") setFallback({ text: unavailableText(outcome.reason), runId: outcome.lastCompletedRunId });
    if (outcome.kind === "interrupted") {
      if (outcome.view) setView(outcome.view);
      setNotice("A execução foi interrompida por inatividade.");
    }
    if (outcome.kind === "error") setNotice(outcome.message);
    void loadWallet();
  }

  return (
    <>
      <WalletPanel wallet={wallet} />
      <div className="controls">
        <button type="button" className="primary" onClick={run} disabled={!hydrated || phase === "running"}>
          Executar com R$ 54,00
        </button>
        <p className="run-status" data-testid="run-status" role="status" aria-live="polite">
          {runStatusText(phase, view)}
        </p>
        {notice && <p className="notice">{notice}</p>}
        {fallback && (
          <p className="notice">
            {fallback.text} {fallback.runId && <a href={`/r/${fallback.runId}`}>Veja a última travessia concluída.</a>}
          </p>
        )}
      </div>
      <Rail progress={railProgress(view)} />
      <Acts view={view} />
      {view && view.verifications.length > 0 && <Receipt view={view} />}
      {view?.closing && <Closing closing={view.closing} />}
      {view?.status === "completed" && view.payout && <ReplayProof runId={view.id} first={view.payout} initial={view.replays} />}
      {view && view.status !== "running" && <RunLinks runId={view.id} />}
    </>
  );
}
