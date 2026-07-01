import { NextResponse } from "next/server";

import { getLeadDeliveryDetail } from "@/lib/front-office/api/get-lead-delivery";
import { requireFrontOfficeSession } from "@/lib/front-office/api/session";

export async function GET(
  request: Request,
  context: { params: Promise<{ leadUid: string }> }
) {
  const { leadUid } = await context.params;
  const url = new URL(request.url);
  const session = await requireFrontOfficeSession(url.searchParams.get("role"));
  if (!session) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  const detail = await getLeadDeliveryDetail(leadUid, session.role, session.clientAccountId);
  if (!detail) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, detail });
}
