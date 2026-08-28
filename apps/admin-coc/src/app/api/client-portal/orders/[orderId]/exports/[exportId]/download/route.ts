import { cookies } from "next/headers";

import { fetchClientLeadOrderExportDownload } from "@/lib/client-portal-api/server";
import { getPortalSession } from "@/lib/client-portal/access-gate";
import { guardClientPortalBffSession } from "@/lib/client-portal/portal-bff-auth";
import { parsePortalExportId, parsePortalOrderId } from "@/lib/client-portal/portal-order-detail";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ orderId: string; exportId: string }> }
) {
  const store = await cookies();
  const sessionCookie = store.get(CLIENT_PORTAL_SESSION_COOKIE)?.value;
  const denied = guardClientPortalBffSession(sessionCookie);
  if (denied) return denied;

  const session = getPortalSession(sessionCookie);
  if (!session?.clientAccountId) {
    return Response.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }

  const { orderId: rawOrderId, exportId: rawExportId } = await context.params;
  const orderId = parsePortalOrderId(rawOrderId);
  const exportId = parsePortalExportId(rawExportId);
  if (!orderId || !exportId) {
    return Response.json({ ok: false, error: "Delivery not found" }, { status: 404 });
  }

  const result = await fetchClientLeadOrderExportDownload({
    clientAccountId: session.clientAccountId,
    orderId,
    exportId,
  });
  if (!result.ok) {
    const status = result.status === 404 || result.status === 403 || result.status === 401
      ? 404
      : result.status || 502;
    return Response.json(
      { ok: false, error: status === 404 ? "Delivery not found" : "Download failed" },
      { status }
    );
  }

  return new Response(result.body, {
    status: 200,
    headers: {
      "content-type": result.contentType,
      "content-disposition": result.contentDisposition,
      "x-content-type-options": "nosniff",
    },
  });
}
