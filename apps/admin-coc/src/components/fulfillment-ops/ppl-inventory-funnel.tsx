import { StatTile } from "@/components/dashboard/stat-tile";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import type { InventorySelectionFunnelReport } from "@/lib/fulfillment-ops/client-api";

const STAGE_ROWS: Array<{
  key: string;
  label: string;
  value: (report: InventorySelectionFunnelReport) => number;
}> = [
  { key: "niche", label: "Commerce niche aliases", value: (report) => report.stages.nicheMatch },
  { key: "states", label: "Order states", value: (report) => report.stages.states },
  { key: "age", label: "Commerce age bucket", value: (report) => report.stages.ageBucket },
  { key: "aged", label: "Aged inventory", value: (report) => report.stages.inventoryClassAged },
  { key: "lot", label: "Active lot", value: (report) => report.stages.activeLot },
  { key: "available", label: "Status available", value: (report) => report.stages.status.available },
  { key: "commerce", label: "Not commerce-excluded", value: (report) => report.stages.commerceIncluded },
  { key: "identity", label: "Valid phone or email", value: (report) => report.stages.validIdentity },
  { key: "ready", label: "Buyer-ready", value: (report) => report.stages.buyerReady.ready },
  { key: "protected", label: "After protected-agent", value: (report) => report.stages.afterProtectedAgent },
  { key: "origin", label: "After origin-client", value: (report) => report.stages.afterOriginClient },
  { key: "buyer", label: "After same-buyer", value: (report) => report.stages.afterSameBuyer },
  { key: "eligible", label: "Final eligible", value: (report) => report.stages.finalEligible },
];

function causeLabels(report: InventorySelectionFunnelReport): string[] {
  const labels: string[] = [];
  if (report.causes.inventoryActivation) labels.push("inventory activation");
  if (report.causes.importFieldLoss) labels.push("import field loss");
  if (report.causes.buyerReadyPolicy) labels.push("buyer-ready policy");
  return labels;
}

/** Operator-only counts. Never renders lead payloads. */
export function PplInventoryFunnelPanel({ report }: { report: InventorySelectionFunnelReport }) {
  const causes = causeLabels(report);
  const buyer = report.stages.buyerReady;
  const status = report.stages.status;
  return (
    <div className="space-y-3" data-testid="ppl-inventory-funnel">
      <WarningBanner
        tone={report.primaryDisappearance === "none" ? "info" : "warn"}
        title="Inventory funnel"
      >
        {report.summary} Requested {report.requestedQuantity}. Final eligible{" "}
        {report.stages.finalEligible}.
        {causes.length > 0 ? ` Causes: ${causes.join(", ")}.` : ""}
      </WarningBanner>
      <div className="grid gap-3 md:grid-cols-4">
        {STAGE_ROWS.map((stage) => (
          <StatTile key={stage.key} label={stage.label} value={stage.value(report)} />
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <StatTile label="Pending review" value={status.pending_review} />
        <StatTile label="Reserved" value={status.reserved} />
        <StatTile label="Committed" value={status.committed} />
        <StatTile label="Other status" value={status.other} />
        <StatTile label="Commerce excluded" value={report.stages.commerceExcludedAt.set} />
        <StatTile label="Invalid phone and email" value={report.stages.invalidIdentity} />
        <StatTile label="Missing consumer age" value={buyer.missing_consumer_age} />
        <StatTile label="First name too short" value={buyer.first_name_too_short} />
        <StatTile label="Last name too short" value={buyer.last_name_too_short} />
        <StatTile label="Multipart first name" value={buyer.first_name_multipart} />
        <StatTile label="Multipart last name" value={buyer.last_name_multipart} />
        <StatTile label="Protected-agent excluded" value={report.stages.protectedAgentExcluded} />
        <StatTile label="Origin-client excluded" value={report.stages.originClientExcluded} />
        <StatTile label="Same-buyer prior delivery" value={report.stages.sameBuyerPriorDelivery} />
        <StatTile label="Within-selection duplicate" value={report.stages.withinSelectionDuplicate} />
        <StatTile
          label="Otherwise eligible, missing age"
          value={report.otherwiseEligibleBlockedByMissingConsumerAge}
        />
        <StatTile label="Recoverable stored age" value={report.recoverableStoredConsumerAge} />
        <StatTile label="No stored consumer age" value={report.noStoredConsumerAge} />
        <StatTile
          label="Pending review, no stored age"
          value={report.pendingReviewConsumerAge.noStoredConsumerAge}
        />
      </div>
      <p className="text-xs text-muted-foreground" data-testid="ppl-inventory-funnel-note">
        Niche aliases: {report.nicheAliases.join(", ") || report.nicheKey}. States:{" "}
        {report.states.join(", ") || "—"}. Buckets: {report.commerceAgeBucketKeys.join(", ")}.{" "}
        {report.agedImportFieldLoss.summary}
      </p>
    </div>
  );
}
