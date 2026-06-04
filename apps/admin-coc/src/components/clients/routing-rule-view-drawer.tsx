"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CocDetailViewShell } from "@/components/CocDetailViewShell";
import type { RoutingRuleWithReadinessItem } from "@/lib/delivery-readiness/types";
import {
  readinessStatusBadgeClass,
  readinessStatusLabel,
} from "@/lib/delivery-readiness/delivery-readiness-display";
import { cn } from "@/lib/utils";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(120px,38%)_1fr] gap-x-2 gap-y-1 text-sm">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-all font-mono text-xs">{value}</dd>
    </div>
  );
}

function dash(v: string | null | undefined): string {
  return v?.trim() ? v.trim() : "—";
}

export function RoutingRuleViewDrawer({
  rule,
  open,
  onOpenChange,
  onConfigure,
  onDelete,
  deletePending,
}: {
  rule: RoutingRuleWithReadinessItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfigure?: () => void;
  onDelete?: () => void;
  deletePending?: boolean;
}) {
  if (!rule) return null;

  return (
    <CocDetailViewShell
      open={open}
      onOpenChange={onOpenChange}
      title="Routing rule"
      subtitle={<span className="font-mono text-xs">{rule.id}</span>}
      sheetClassName="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-lg"
      bodyClassName="flex flex-col gap-4"
    >
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={cn("w-fit", readinessStatusBadgeClass(rule.readiness.readinessStatus))}
          >
            {readinessStatusLabel(rule.readiness.readinessStatus)}
          </Badge>
          <Badge variant="outline">{rule.matchType}</Badge>
          {rule.active ? (
            <Badge variant="secondary">active</Badge>
          ) : (
            <Badge variant="outline">inactive</Badge>
          )}
        </div>

        <dl className="space-y-2">
          <Field label="Client" value={`${rule.clientDisplayName ?? rule.clientAccountId}`} />
          <Field label="Client account ID" value={rule.clientAccountId} />
          <Field label="Master account" value={rule.masterClientAccountId} />
          <Field label="GHL location" value={dash(rule.destinationSubaccountIdGhl)} />
          <Field label="Priority" value={String(rule.priority)} />
          <Field label="Campaign ID" value={dash(rule.campaignId)} />
          <Field label="Campaign name" value={dash(rule.campaignName)} />
          <Field label="UTM campaign" value={dash(rule.utmCampaign)} />
          <Field label="Niche" value={dash(rule.nicheKey)} />
          <Field label="Product type" value={dash(rule.productType)} />
          <Field label="Workflow ID" value={dash(rule.destinationWorkflowIdGhl)} />
          <Field label="Pipeline ID" value={dash(rule.destinationPipelineIdGhl)} />
          <Field label="Stage ID" value={dash(rule.destinationPipelineStageIdGhl)} />
          <Field label="Delivery mode" value={rule.deliveryMode} />
        </dl>

        {rule.readiness.blockers.length > 0 ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-50/50 px-3 py-2 text-xs dark:bg-amber-950/20">
            <p className="font-medium text-amber-950 dark:text-amber-100">Blockers</p>
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              {rule.readiness.blockers.slice(0, 6).map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {onConfigure ? (
            <Button type="button" size="sm" onClick={onConfigure}>
              Delivery config
            </Button>
          ) : null}
          <Link
            href={`/routing-dry-run?masterClientAccountId=${encodeURIComponent(rule.masterClientAccountId)}&clientAccountId=${encodeURIComponent(rule.clientAccountId)}`}
            className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium"
          >
            Routing dry run
          </Link>
          {onDelete ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={deletePending}
              onClick={onDelete}
            >
              {deletePending ? "Deleting…" : "Delete rule"}
            </Button>
          ) : null}
        </div>
    </CocDetailViewShell>
  );
}
