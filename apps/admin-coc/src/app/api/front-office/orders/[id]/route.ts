import { NextResponse } from "next/server";

import { updateOrder } from "@/lib/front-office/api/get-orders";
import { requireFrontOfficeSession } from "@/lib/front-office/api/session";
import type { UpdateLeadOrderInput } from "@/lib/front-office/types";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await requireFrontOfficeSession(null);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Admin only" }, { status: 403 });
  }
  const { id } = await context.params;
  let body: UpdateLeadOrderInput;
  try {
    body = (await request.json()) as UpdateLeadOrderInput;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const order = await updateOrder(id, body, session.role);
  if (!order) {
    return NextResponse.json({ ok: false, error: "Failed to update order" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, order });
}
