import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";
import { leadOrderReviewResponse } from "@/lib/coc-orders/coc-order-review-route";
import { approveLeadOrderAdmin } from "@/lib/front-office/api/lead-order-review-actions";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const { id } = await context.params;
  return leadOrderReviewResponse(await approveLeadOrderAdmin(id));
}
