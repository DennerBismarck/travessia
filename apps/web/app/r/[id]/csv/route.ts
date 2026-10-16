import { runToCsv } from "@/lib/run/csv";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const view = await getServices().orchestrator.getView(id);
  if (!view) return new Response("Execução não encontrada.", { status: 404 });
  // BOM para o Excel abrir os acentos em UTF-8.
  return new Response(`﻿${runToCsv(view)}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="travessia-${view.id}.csv"`,
      "cache-control": "no-store",
    },
  });
}
