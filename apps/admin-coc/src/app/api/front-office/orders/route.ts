import { NextResponse } from "next/server";

import { createOrder, getOrders } from "@/lib/front-office/api/get-orders";
import { requireFrontOfficeSession } from "@/lib/front-office/api/session";
import type { CreateLeadOrderInput } from "@/lib/front-office/types";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const session = await requireFrontOfficeSession(url.searchParams.get("role"));
  if (!session) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  const data = await getOrders(session.role, {
    clientAccountId: session.clientAccountId,
    status: url.searchParams.get("status") ?? undefined,
    nicheKey: url.searchParams.get("niche") ?? undefined,
  });
  return NextResponse.json({ ok: true, orders: data.orders, dataSource: data.dataSource });
}

export async function POST(request: Request) {
  const session = await requireFrontOfficeSession(null);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  if (session.role === "agent") {
    return NextResponse.json({ ok: false, error: "Agents cannot create orders" }, { status: 403 });
  }
  let body: CreateLeadOrderInput;
  try {
    body = (await request.json()) as CreateLeadOrderInput;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const order = await createOrder(body, session.role, session.clientAccountId);
  if (!order) {
    return NextResponse.json({ ok: false, error: "Failed to create order" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, order });
}
