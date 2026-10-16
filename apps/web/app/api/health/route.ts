import { toResponse } from "@/lib/http";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Checagem do Fly: responde sem chamar a Hodle nem o RPC.
  if (new URL(request.url).searchParams.get("shallow") === "1") return toResponse({ status: 200, body: { ok: true } });
  return toResponse({ status: 200, body: await getServices().health.check() });
}
