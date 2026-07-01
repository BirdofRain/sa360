import { NextResponse } from "next/server";

import { getDashboard } from "@/lib/front-office/api/get-dashboard";
import { requireFrontOfficeSession } from "@/lib/front-office/api/session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const session = await requireFrontOfficeSession(url.searchParams.get("role"));
  if (!session) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  const data = await getDashboard(session.role, session.clientAccountId);
  return NextResponse.json({ ok: true, data });
}
