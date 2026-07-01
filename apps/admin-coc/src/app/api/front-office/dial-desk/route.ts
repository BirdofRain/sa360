import { NextResponse } from "next/server";

import { getDialDesk } from "@/lib/front-office/api/get-dial-desk";
import { requireFrontOfficeSession } from "@/lib/front-office/api/session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const session = await requireFrontOfficeSession(url.searchParams.get("role"));
  if (!session) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  const data = await getDialDesk(session.role);
  if (!data) {
    return NextResponse.json({ ok: false, error: "Not available" }, { status: 403 });
  }
  return NextResponse.json({ ok: true, data });
}
