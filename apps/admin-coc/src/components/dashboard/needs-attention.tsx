import { Suspense } from "react";

import { AttentionCard, AttentionCardLoading } from "@/components/dashboard/attention-card";
import {
  loadOrdersAwaitingOperatorAction,
  loadSourceIntakeAwaitingReview,
} from "@/lib/command-center/attention-queue";
import { ORDERS_AWAITING_ACTION_HREF } from "@/lib/front-office/order-review";
import { SOURCE_INTAKE_AWAITING_REVIEW_HREF } from "@/lib/source-intake/source-intake-query";

const ORDERS_TITLE = "Orders awaiting operator action";
const SOURCE_TITLE = "Source intake awaiting review";

const ORDERS_HINT =
  "Submitted / Payment pending, Submitted / Payment confirmed, and Submitted / Payment not required.";
const SOURCE_HINT = "Source leads with status needs_review.";

async function OrdersAttentionCard() {
  const read = await loadOrdersAwaitingOperatorAction();
  return (
    <AttentionCard
      title={ORDERS_TITLE}
      hint={ORDERS_HINT}
      emptyHint="No orders are waiting for payment confirmation or approval."
      href={ORDERS_AWAITING_ACTION_HREF}
      read={read}
      testId="attention-orders"
    />
  );
}

async function SourceIntakeAttentionCard() {
  const read = await loadSourceIntakeAwaitingReview();
  return (
    <AttentionCard
      title={SOURCE_TITLE}
      hint={SOURCE_HINT}
      emptyHint="No source leads are waiting in needs_review."
      href={SOURCE_INTAKE_AWAITING_REVIEW_HREF}
      read={read}
      testId="attention-source-intake"
    />
  );
}

export function NeedsAttentionSection() {
  return (
    <section aria-labelledby="needs-attention-heading" className="space-y-3" data-testid="needs-attention">
      <div>
        <h2 id="needs-attention-heading" className="text-sm font-medium text-slate-800">
          Needs attention
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Open the matching queue. A zero appears only after the full filtered list is read.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Suspense fallback={<AttentionCardLoading title={ORDERS_TITLE} />}>
          <OrdersAttentionCard />
        </Suspense>
        <Suspense fallback={<AttentionCardLoading title={SOURCE_TITLE} />}>
          <SourceIntakeAttentionCard />
        </Suspense>
      </div>
    </section>
  );
}
