import { renderCard } from "@/lib/og/card";
import { getServices } from "@/lib/services";
import { formatDateTimeBr } from "@/lib/ui/labels";

export const alt = "Comprovante da Travessia, conferido na Base Sepolia";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await getServices().orchestrator.getView(id);
  if (!view) {
    return renderCard({ eyebrow: "Travessia", title: "Comprovante não encontrado", lines: [], footer: "Não oficial · construído sobre o sandbox da Hodle" });
  }
  const confirmed = view.verifications.filter((v) => v.result === "confere").length;
  return renderCard({
    eyebrow: `Comprovante ${view.id} · ${formatDateTimeBr(view.startedAt)}`,
    title: view.status === "completed" ? "Travessia concluída" : "Travessia incompleta",
    lines: [
      ...(view.closing ? [`Entrou ${view.closing.display.in} · Pix ${view.closing.display.pixOut} · guardado ${view.closing.display.kept}`] : []),
      `${confirmed} de ${view.verifications.length} movimentos conferidos na Base Sepolia`,
    ],
    footer: "Não oficial · construído sobre o sandbox da Hodle",
  });
}
