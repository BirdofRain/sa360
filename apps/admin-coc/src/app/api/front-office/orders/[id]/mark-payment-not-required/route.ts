import { markLeadOrderPaymentNotRequiredAdmin } from "@/lib/front-office/api/lead-order-review-actions";
import { handleLeadOrderReviewMutation } from "@/lib/front-office/api/lead-order-review-route";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return handleLeadOrderReviewMutation(id, (confirmedBy) =>
    markLeadOrderPaymentNotRequiredAdmin(id, confirmedBy)
  );
}
