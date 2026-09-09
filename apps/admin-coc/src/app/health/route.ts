import { NextResponse } from "next/server";

/** Alias of `/api/health` for platforms that probe `/health`. */
export async function GET() {
  return NextResponse.json({ ok: true, service: "admin-coc" });
}
