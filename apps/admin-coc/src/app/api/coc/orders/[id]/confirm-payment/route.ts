import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";
import {
  COC_ORDER_CONFIRMED_BY,
  leadOrderReviewResponse,
} from "@/lib/coc-orders/coc-order-review-route";
import { confirmLeadOrderPaymentAdmin } from "@/lib/front-office/api/lead-order-review-actions";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const { id } = await context.params;
  return leadOrderReviewResponse(await confirmLeadOrderPaymentAdmin(id, COC_ORDER_CONFIRMED_BY));
}
