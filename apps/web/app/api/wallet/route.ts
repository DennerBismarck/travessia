import { toResponse } from "@/lib/http";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function GET() {
  return toResponse({ status: 200, body: await getServices().wallet.read() });
}
