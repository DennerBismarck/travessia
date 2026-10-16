import { startHttp, toResponse } from "@/lib/http";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

export function POST() {
  return toResponse(startHttp(getServices().orchestrator.start()));
}
