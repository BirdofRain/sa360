import { NextResponse } from "next/server";

import type { LeadOrderReviewActionResult } from "@/lib/front-office/api/lead-order-review-actions";
import type { UpdateLeadOrderInput } from "@/lib/front-office/types";

export const COC_ORDER_CONFIRMED_BY = "Admin C.O.C.";

export function leadOrderReviewResponse(result: LeadOrderReviewActionResult): NextResponse {
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        code: result.code,
        reasons: result.reasons,
        order: result.order,
      },
      { status: result.status || 500 }
    );
  }
  return NextResponse.json({ ok: true, order: result.order });
}

/**
 * Notes and the existing status dropdown only. Activation is not a field this
 * route forwards; Fulfillment Ops owns that transition.
 */
export function cocOrderUpdateFromBody(body: unknown):
  | { ok: true; input: UpdateLeadOrderInput }
  | { ok: false; status: number; error: string; code: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, status: 400, error: "Invalid JSON", code: "invalid_json" };
  }
  const record = body as Record<string, unknown>;
  const input: UpdateLeadOrderInput = {};
  if (typeof record.status === "string") {
    if (record.status === "active") {
      return {
        ok: false,
        status: 409,
        error: "Activation stays in Fulfillment Ops.",
        code: "activation_requires_fulfillment_ops",
      };
    }
    input.status = record.status as UpdateLeadOrderInput["status"];
  }
  if (typeof record.adminNotes === "string") input.adminNotes = record.adminNotes;
  if (record.routingRuleId === null || typeof record.routingRuleId === "string") {
    input.routingRuleId = record.routingRuleId;
  }
  if (record.campaignId === null || typeof record.campaignId === "string") {
    input.campaignId = record.campaignId;
  }
  return { ok: true, input };
}
