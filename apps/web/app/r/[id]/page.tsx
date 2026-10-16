import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Acts } from "@/components/Acts";
import { Closing } from "@/components/Closing";
import { Header } from "@/components/Header";
import { Receipt } from "@/components/Receipt";
import { ReplayProof } from "@/components/ReplayProof";
import { RunLinks } from "@/components/RunLinks";
import { SiteFooter } from "@/components/SiteFooter";
import { getServices } from "@/lib/services";
import { formatDateTimeBr, runStatusText } from "@/lib/ui/labels";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Comprovante ${id} — Travessia`,
    description: "Pix, dólar e Pix de volta no sandbox da Hodle, com cada movimento conferido na Base Sepolia.",
  };
}

export default async function ReceiptPage({ params }: Props) {
  const { id } = await params;
  const view = await getServices().orchestrator.getView(id, { recheck: true });
  if (!view) notFound();
  return (
    <main className="page">
      <Header />
      <section className="panel" aria-labelledby="execucao-titulo">
        <h2 id="execucao-titulo" className="panel-title">
          Execução {view.id} · {formatDateTimeBr(view.startedAt)}
        </h2>
        <p className="run-status" data-testid="run-status">
          {runStatusText("done", view)}
        </p>
        {view.walletAddress && (
          <p className="small">
            Carteira de teste:{" "}
            <a className="hash mono" href={view.walletExplorerUrl ?? undefined} target="_blank" rel="noreferrer">
              {view.walletAddress}
            </a>
          </p>
        )}
      </section>
      {view.verifications.length > 0 && <Receipt view={view} />}
      {view.closing && <Closing closing={view.closing} />}
      {view.status === "completed" && view.payout && <ReplayProof runId={view.id} first={view.payout} initial={view.replays} />}
      <RunLinks runId={view.id} />
      <Acts view={view} />
      <p className="run-links">
        <a href="/">Executar uma nova travessia</a>
      </p>
      <SiteFooter />
    </main>
  );
}
