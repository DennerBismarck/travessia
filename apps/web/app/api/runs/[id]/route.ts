import { toResponse } from "@/lib/http";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const view = await getServices().orchestrator.getView(id, { recheck: true });
  return toResponse(view ? { status: 200, body: view } : { status: 404, body: { error: "not_found" } });
}
