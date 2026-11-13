import { Suspense } from "react";

import { ActivitySnapshotIntro } from "@/components/dashboard/activity-snapshot-intro";
import { AttentionCard, AttentionCardLoading } from "@/components/dashboard/attention-card";
import { deliveryFailureRefreshedLabel } from "@/lib/command-center/activity-snapshot";
import { loadDeliveryFailuresRequiringAction } from "@/lib/command-center/attention-queue";
import { SOURCE_INTAKE_DELIVERY_FAILED_HREF } from "@/lib/source-intake/source-intake-query";

const DELIVERY_TITLE = "Source Intake delivery failures";

const DELIVERY_HINT =
  "Source leads in delivery_failed after an external write failed. Requeue is required before another attempt. Recovered retries and skips are other statuses.";

async function DeliveryFailuresCard() {
  const read = await loadDeliveryFailuresRequiringAction();
  return (
    <AttentionCard
      title={DELIVERY_TITLE}
      hint={DELIVERY_HINT}
      emptyHint="No source leads are waiting in delivery_failed."
      href={SOURCE_INTAKE_DELIVERY_FAILED_HREF}
      read={read.state === "ready" ? { state: "ready", count: read.count } : read}
      detail={read.state === "ready" ? deliveryFailureRefreshedLabel(read.refreshedAt) : undefined}
      testId="activity-delivery-failures"
    />
  );
}

export function ActivitySnapshotSection() {
  return (
    <section aria-labelledby="activity-snapshot-heading" className="space-y-3" data-testid="activity-snapshot">
      <ActivitySnapshotIntro />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Suspense fallback={<AttentionCardLoading title={DELIVERY_TITLE} />}>
          <DeliveryFailuresCard />
        </Suspense>
      </div>
    </section>
  );
}
