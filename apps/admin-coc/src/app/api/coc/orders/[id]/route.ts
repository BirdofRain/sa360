import { NextResponse } from "next/server";

import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";
import {
  cocOrderUpdateFromBody,
  leadOrderReviewResponse,
} from "@/lib/coc-orders/coc-order-review-route";
import { updateOrder } from "@/lib/front-office/api/get-orders";
import { fetchLeadOrderForReview } from "@/lib/front-office/api/lead-order-review-actions";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const { id } = await context.params;
  return leadOrderReviewResponse(await fetchLeadOrderForReview(id));
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = cocOrderUpdateFromBody(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.error, code: parsed.code },
      { status: parsed.status }
    );
  }
  const order = await updateOrder(id, parsed.input, "admin");
  if (!order) {
    return NextResponse.json(
      { ok: false, error: "The order could not be updated. Refresh and try again." },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, order });
}
