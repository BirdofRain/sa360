"use client";

import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { RoutingAttributionSnapshot, RoutingDryRunDecisionItem } from "@/lib/routing-dry-run/types";
import {
  confidenceBadgeClass,
  deliveryModeBadgeClass,
  displayLeadLabel,
  displayMatchType,
  formatRoutingDryRunTime,
  matchBadgeClass,
  matchStatusLabel,
  parseAttributionSnapshot,
} from "@/lib/routing-dry-run/routing-dry-run-display";
import { RoutingDryRunDeliverySection } from "@/components/dashboard/routing-dry-run-delivery-section";
import { RoutingDryRunDuplicateRiskSection } from "@/components/dashboard/routing-dry-run-duplicate-risk-section";
import { RoutingDryRunReadinessSection } from "@/components/dashboard/routing-dry-run-readiness-section";
import { RoutingDryRunSuggestedReviewSection } from "@/components/dashboard/routing-dry-run-suggested-review-section";
import { RoutingDryRunValidationPanel } from "@/components/dashboard/routing-dry-run-validation-panel";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { deliveryPlanSummaryLabel } from "@/lib/routing-dry-run/delivery-plan-display";
import {
  sa360PredictedClientLabel,
  sa360PredictedSubaccount,
  validationStatusBadgeClass,
  validationStatusLabel,
} from "@/lib/routing-dry-run/routing-dry-run-validation-display";
import { cn } from "@/lib/utils";

function DetailSectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card/50 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function FieldGrid({ rows }: { rows: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-[minmax(120px,38%)_1fr] gap-x-2 gap-y-1.5 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-xs text-muted-foreground">{row.label}</dt>
          <dd className="break-all font-mono text-xs">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function cellOrDash(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return value;
}

const ATTRIBUTION_KEYS: Array<{ key: keyof RoutingAttributionSnapshot; label: string }> = [
  { key: "sourcePlatform", label: "sourcePlatform" },
  { key: "sourceType", label: "sourceType" },
  { key: "campaignId", label: "campaignId" },
  { key: "campaignName", label: "campaignName" },
  { key: "adsetId", label: "adsetId" },
  { key: "adId", label: "adId" },
  { key: "formId", label: "formId" },
  { key: "utmCampaign", label: "utmCampaign" },
  { key: "utmContent", label: "utmContent" },
  { key: "masterDatasetId", label: "masterDatasetId" },
];

export function RoutingDryRunDetailDrawer({
  row,
  open,
  onOpenChange,
  onRowUpdated,
}: {
  row: RoutingDryRunDecisionItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRowUpdated?: (item: RoutingDryRunDecisionItem) => void;
}) {
  if (!row) return null;

  const attr = parseAttributionSnapshot(row.attributionSnapshot);
  const lead = row.leadIdentity;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Routing dry-run decision</SheetTitle>
          <SheetDescription>
            {formatRoutingDryRunTime(row.createdAt)} · {row.sourceLeadUid}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 pb-6">
          <DetailSectionCard title="Decision summary">
            <FieldGrid
              rows={[
                { label: "Decision ID", value: row.id },
                { label: "Created at", value: formatRoutingDryRunTime(row.createdAt) },
                {
                  label: "Matched",
                  value: (
                    <Badge variant="outline" className={cn("w-fit", matchBadgeClass(row.matched))}>
                      {matchStatusLabel(row)}
                    </Badge>
                  ),
                },
                {
                  label: "Confidence",
                  value: (
                    <Badge variant="outline" className={cn("w-fit", confidenceBadgeClass(row.confidence, row.matched))}>
                      {row.confidence}
                    </Badge>
                  ),
                },
                { label: "Match type", value: displayMatchType(row.matchType) },
                { label: "Reason", value: row.reason },
                {
                  label: "Delivery mode",
                  value: (
                    <Badge variant="outline" className={cn("w-fit", deliveryModeBadgeClass())}>
                      {row.deliveryMode}
                    </Badge>
                  ),
                },
                { label: "Routing event", value: row.routingEventNameInternal },
              ]}
            />
          </DetailSectionCard>

          <DetailSectionCard title="Lead identity">
            <FieldGrid
              rows={[
                { label: "Lead UID", value: row.sourceLeadUid },
                { label: "Contact ID (GHL)", value: cellOrDash(lead?.contactIdGhl) },
                { label: "Lead name", value: displayLeadLabel(row) },
                { label: "Phone", value: cellOrDash(lead?.phoneE164) },
                { label: "Email", value: cellOrDash(lead?.email) },
                { label: "Master account", value: row.masterClientAccountId },
              ]}
            />
          </DetailSectionCard>

          <DetailSectionCard title="Matched destination">
            <FieldGrid
              rows={[
                { label: "Destination client", value: cellOrDash(row.destinationClientAccountId) },
                {
                  label: "Client display name",
                  value: cellOrDash(row.matchedRuleSummary?.clientDisplayName),
                },
                { label: "Destination subaccount", value: cellOrDash(row.destinationSubaccountIdGhl) },
                { label: "Niche key", value: cellOrDash(row.matchedRuleSummary?.nicheKey ?? attr?.nicheKey) },
                { label: "Product type", value: cellOrDash(row.matchedRuleSummary?.productType ?? attr?.productType) },
                { label: "Matched rule ID", value: cellOrDash(row.matchedRuleId) },
              ]}
            />
          </DetailSectionCard>

          <DetailSectionCard title="Duplicate / identity">
            <RoutingDryRunDuplicateRiskSection row={row} />
          </DetailSectionCard>

          <DetailSectionCard title="Delivery plan / shadow delivery">
            <RoutingDryRunDeliverySection row={row} />
          </DetailSectionCard>

          <DetailSectionCard title="Delivery readiness">
            <RoutingDryRunReadinessSection row={row} />
          </DetailSectionCard>

          <DetailSectionCard title="Suggested review">
            <RoutingDryRunSuggestedReviewSection
              row={row}
              onUpdated={(item) => onRowUpdated?.(item)}
            />
          </DetailSectionCard>

          <DetailSectionCard title="Legacy delivery comparison">
            <FieldGrid
              rows={[
                {
                  label: "Validation",
                  value: (
                    <Badge
                      variant="outline"
                      className={cn("w-fit", validationStatusBadgeClass(row.validationStatus))}
                    >
                      {validationStatusLabel(row.validationStatus)}
                    </Badge>
                  ),
                },
                { label: "SA360 predicted client", value: sa360PredictedClientLabel(row) },
                { label: "SA360 predicted subaccount", value: sa360PredictedSubaccount(row) },
                {
                  label: "SA360 shadow plan status",
                  value: deliveryPlanSummaryLabel(row.deliveryPlanSummary),
                },
                {
                  label: "Legacy delivered client",
                  value: cellOrDash(row.legacyDeliveredClientAccountId),
                },
                {
                  label: "Legacy delivered subaccount",
                  value: cellOrDash(row.legacyDeliveredSubaccountIdGhl),
                },
                {
                  label: "Legacy contact (GHL)",
                  value: cellOrDash(row.legacyDeliveryContactIdGhl),
                },
                { label: "Legacy delivery status", value: cellOrDash(row.legacyDeliveryStatus) },
                { label: "Validation notes", value: cellOrDash(row.validationNotes) },
                { label: "Validated at", value: row.validatedAt ? formatRoutingDryRunTime(row.validatedAt) : "—" },
                { label: "Validated by", value: cellOrDash(row.validatedBy) },
              ]}
            />
            <div className="mt-3 border-t border-border pt-3">
              <RoutingDryRunValidationPanel
                row={row}
                onUpdated={(item) => onRowUpdated?.(item)}
              />
            </div>
          </DetailSectionCard>

          <DetailSectionCard title="Attribution snapshot">
            <FieldGrid
              rows={ATTRIBUTION_KEYS.map(({ key, label }) => ({
                label,
                value: cellOrDash(attr?.[key] != null ? String(attr[key]) : null),
              }))}
            />
          </DetailSectionCard>

          <DetailSectionCard title="Lifecycle events emitted">
            {(row.lifecycleEventsEmitted ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">—</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {(row.lifecycleEventsEmitted ?? []).map((ev) => (
                  <li key={ev}>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {ev}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </DetailSectionCard>

          {!row.matched ? (
            <WarningBanner tone="warn" title="Review required">
              No active routing rule matched this lead. Add or update a CampaignRoutingRule before enabling
              delivery.
            </WarningBanner>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
