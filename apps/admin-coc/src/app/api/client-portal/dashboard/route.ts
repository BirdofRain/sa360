import { fetchClientPortalDashboard } from "@/lib/client-portal-api/server";
import { parseClientPortalRange } from "@/lib/client-portal/range";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const range = parseClientPortalRange(searchParams.get("range") ?? undefined);

  const result = await fetchClientPortalDashboard({ range });
  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.body || "Client portal fetch failed" },
      { status: result.status || 502 }
    );
  }

  return Response.json(result.data);
}
