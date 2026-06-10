import Link from "next/link";

import { buildDeliveryReadinessConfigureHref } from "@/lib/delivery-readiness/delivery-readiness-query";
import { hasGhlDeliveryConfigMissing } from "@/lib/ghl-config/ghl-config-discovery-display";

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

      {readiness.fieldMapping ? (
        <p className="text-xs text-muted-foreground">
          SA360 fields: {readiness.fieldMapping.coreRequiredMapped.length} core mapped,{" "}
          {readiness.fieldMapping.coreRequiredMissing.length} core missing
          {readiness.fieldMapping.customFieldStampRequired ? " (stamping required)" : ""}
        </p>
      ) : null}

      {(readiness.blockers ?? []).length > 0 ? (
        <ul className="list-inside list-disc text-xs text-muted-foreground">
          {(readiness.blockers ?? []).slice(0, 5).map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No blockers for technical readiness.</p>
      )}

      <p className="text-xs text-muted-foreground">
        {readiness.recommendedNextAction ?? "—"}
      </p>

      {row.matchedRuleId ? (
        <div className="flex flex-col gap-1">
          {hasGhlDeliveryConfigMissing(readiness.missingConfig ?? []) ? (
            <Link
              href={buildDeliveryReadinessConfigureHref({
                masterClientAccountId: row.masterClientAccountId,
                clientAccountId: row.destinationClientAccountId ?? "",
                ruleId: row.matchedRuleId,
              })}
              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Configure GHL delivery IDs →
            </Link>
          ) : null}
          <Link
            href={buildDeliveryReadinessConfigureHref({
              masterClientAccountId: row.masterClientAccountId,
              clientAccountId: row.destinationClientAccountId ?? "",
              ruleId: row.matchedRuleId,
            })}
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Open delivery readiness for this client →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
