import { NextResponse } from "next/server";

/** Unauthenticated liveness for DigitalOcean App Platform. */
export async function GET() {
  return NextResponse.json({ ok: true, service: "admin-coc" });
}
