import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { RoutingDryRunDecisionItem } from "@/lib/routing-dry-run/types";
import {
  liveDeliveryAllowedLabel,
  readinessStatusBadgeClass,
  readinessStatusLabel,
} from "@/lib/delivery-readiness/delivery-readiness-display";
import { cn } from "@/lib/utils";

export function RoutingDryRunReadinessSection({ row }: { row: RoutingDryRunDecisionItem }) {
  const readiness = row.deliveryReadiness;
  if (!readiness) {
    return (
      <p className="text-sm text-muted-foreground">
        No matched routing rule — delivery readiness not available.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={cn("w-fit", readinessStatusBadgeClass(readiness.readinessStatus))}
        >
          {readinessStatusLabel(readiness.readinessStatus)}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Live delivery allowed: {liveDeliveryAllowedLabel(readiness.canDeliverLive)}
        </span>
      </div>

      {readiness.blockers.length > 0 ? (
        <ul className="list-inside list-disc text-xs text-muted-foreground">
          {readiness.blockers.slice(0, 5).map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No blockers for technical readiness.</p>
      )}

      <p className="text-xs text-muted-foreground">{readiness.recommendedNextAction}</p>

      {row.matchedRuleId ? (
        <Link
          href={`/delivery-readiness?masterClientAccountId=${encodeURIComponent(row.masterClientAccountId)}&clientAccountId=${encodeURIComponent(row.destinationClientAccountId ?? "")}`}
          className="text-xs font-medium text-primary underline-offset-4 hover:underline"
        >
          Open delivery readiness for this client →
        </Link>
      ) : null}
    </div>
  );
}
