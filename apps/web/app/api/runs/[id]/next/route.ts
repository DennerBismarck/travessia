import { nextHttp, toResponse } from "@/lib/http";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return toResponse(nextHttp(await getServices().orchestrator.next(id)));
}
