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
import { WarningBanner } from "@/components/dashboard/warning-banner";
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
}: {
  row: RoutingDryRunDecisionItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

          <DetailSectionCard title="Attribution snapshot">
            <FieldGrid
              rows={ATTRIBUTION_KEYS.map(({ key, label }) => ({
                label,
                value: cellOrDash(attr?.[key] != null ? String(attr[key]) : null),
              }))}
            />
          </DetailSectionCard>

          <DetailSectionCard title="Lifecycle events emitted">
            {row.lifecycleEventsEmitted.length === 0 ? (
              <p className="text-sm text-muted-foreground">—</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {row.lifecycleEventsEmitted.map((ev) => (
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
