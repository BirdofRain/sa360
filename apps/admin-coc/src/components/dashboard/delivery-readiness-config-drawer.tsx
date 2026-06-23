"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { patchRoutingRuleDeliveryConfigAction } from "@/app/actions/delivery-readiness";
import { GhlConfigDiscoveryPanel } from "@/components/dashboard/ghl-config-discovery-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CocDetailViewShell } from "@/components/CocDetailViewShell";
import type { RoutingRuleWithReadinessItem } from "@/lib/delivery-readiness/types";
import {
  deliveryReadinessTierSummary,
  directCanaryReadinessLabel,
  liveDeliveryAllowedLabel,
} from "@/lib/delivery-readiness/delivery-readiness-display";
import { buildRoutingDryRunHref } from "@/lib/routing-dry-run/routing-dry-run-query";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type FormState = {
  destinationWorkflowIdGhl: string;
  destinationPipelineIdGhl: string;
  destinationPipelineStageIdGhl: string;
  defaultAssignedUserIdGhl: string;
  backupSheetEnabled: boolean;
  backupSheetId: string;
  snapshotInstalled: boolean;
  requiredFieldsInstalled: boolean;
  ghlConnectionStatus: string;
  deliveryMode: string;
  deliveryEnabled: boolean;
  clientCutoverApproved: boolean;
  internalApprovalStatus: string;
};

function formFromRule(rule: RoutingRuleWithReadinessItem): FormState {
  return {
    destinationWorkflowIdGhl: rule.destinationWorkflowIdGhl ?? "",
    destinationPipelineIdGhl: rule.destinationPipelineIdGhl ?? "",
    destinationPipelineStageIdGhl: rule.destinationPipelineStageIdGhl ?? "",
    defaultAssignedUserIdGhl: rule.defaultAssignedUserIdGhl ?? "",
    backupSheetEnabled: rule.backupSheetEnabled,
    backupSheetId: rule.backupSheetId ?? "",
    snapshotInstalled: rule.snapshotInstalled,
    requiredFieldsInstalled: rule.requiredFieldsInstalled,
    ghlConnectionStatus: rule.ghlConnectionStatus ?? "",
    deliveryMode: rule.deliveryMode,
    deliveryEnabled: rule.deliveryEnabled,
    clientCutoverApproved: rule.clientCutoverApproved,
    internalApprovalStatus: rule.internalApprovalStatus,
  };
}

export function DeliveryReadinessConfigDrawer({
  rule,
  open,
  onOpenChange,
  onUpdated,
}: {
  rule: RoutingRuleWithReadinessItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated?: (item: RoutingRuleWithReadinessItem) => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(null);
  const [confirmLive, setConfirmLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (rule) setForm(formFromRule(rule));
  }, [rule]);

  if (!rule || !form) return null;

  function save() {
    if (!form || !rule) return;
    setError(null);
    const trimOrNull = (v: string) => {
      const t = v.trim();
      return t ? t : null;
    };
    const wantsLive = form.deliveryEnabled || form.deliveryMode === "live";
    if (wantsLive && !confirmLive) {
      setError("Check “I understand live delivery risk” before enabling live mode.");
      return;
    }
    startTransition(async () => {
      const res = await patchRoutingRuleDeliveryConfigAction(rule.id, {
        destinationWorkflowIdGhl: trimOrNull(form.destinationWorkflowIdGhl),
        destinationPipelineIdGhl: trimOrNull(form.destinationPipelineIdGhl),
        destinationPipelineStageIdGhl: trimOrNull(form.destinationPipelineStageIdGhl),
        defaultAssignedUserIdGhl: trimOrNull(form.defaultAssignedUserIdGhl),
        backupSheetEnabled: form.backupSheetEnabled,
        backupSheetId: trimOrNull(form.backupSheetId),
        snapshotInstalled: form.snapshotInstalled,
        requiredFieldsInstalled: form.requiredFieldsInstalled,
        ghlConnectionStatus: trimOrNull(form.ghlConnectionStatus),
        deliveryMode: form.deliveryMode,
        deliveryEnabled: form.deliveryEnabled,
        clientCutoverApproved: form.clientCutoverApproved,
        internalApprovalStatus: form.internalApprovalStatus,
        confirmLiveDeliveryRisk: wantsLive ? true : undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onUpdated?.(res.item);
      setForm(formFromRule(res.item));
      router.refresh();
    });
  }

  return (
    <CocDetailViewShell
      open={open}
      onOpenChange={onOpenChange}
      title="Delivery config"
      subtitle={`${rule.clientDisplayName ?? rule.clientAccountId} · ${rule.matchType}`}
      sheetClassName="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-lg"
      bodyClassName="flex flex-col gap-4"
    >
          <p className="text-xs text-muted-foreground">
            Shadow only — updating config does not create GHL contacts or start workflows.
            GHL adapter simulation requires API env{" "}
            <span className="font-mono">GHL_DELIVERY_ADAPTER_MODE=simulate</span>.
          </p>

        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
          <p className="font-medium">Readiness tiers</p>
          <ul className="mt-1 list-disc pl-4 text-muted-foreground">
            <li>
              Shadow: {rule.readiness.readyForShadow ? "ready" : "not ready"}
            </li>
            <li>
              Direct canary: {directCanaryReadinessLabel(rule.readiness.readyForDirectCanary)}
            </li>
            <li>
              Full delivery: {deliveryReadinessTierSummary(rule.readiness)} · live OK:{" "}
              {liveDeliveryAllowedLabel(rule.readiness.canDeliverLive)}
            </li>
          </ul>
        </div>

        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
          <p className="font-medium">Routing rule (this drawer)</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">{rule.id}</p>
          <p className="mt-1">
            Match: <span className="font-medium">{rule.matchType}</span>
            {rule.campaignId ? ` · campaign_id ${rule.campaignId}` : ""}
            {rule.utmCampaign ? ` · utm_campaign ${rule.utmCampaign}` : ""}
          </p>
          <p className="mt-1 text-muted-foreground">
            Destination: {rule.clientAccountId} · {rule.destinationSubaccountIdGhl || "—"}
          </p>
          <p className="mt-1 text-muted-foreground">
            Field mappings are stored on the client destination and shared by all routing rules for
            this client/location.
          </p>
        </div>

        {rule.readiness.fieldMapping ? (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
            <p className="font-medium">SA360 field mapping (saved destination)</p>
            <p className="mt-1 text-muted-foreground">
              Source: {rule.readiness.fieldMapping.source} ·{" "}
              {rule.readiness.fieldMapping.coreRequiredMapped.length} core mapped ·{" "}
              {rule.readiness.fieldMapping.coreRequiredMissing.length} core missing
              {rule.readiness.fieldMapping.customFieldStampRequired
                ? " · stamping required for live"
                : ""}
            </p>
            {rule.readiness.fieldMapping.coreRequiredMissing.length > 0 ? (
              <p className="mt-1 text-amber-900 dark:text-amber-100">
                Missing core: {rule.readiness.fieldMapping.coreRequiredMissing.join(", ")}
              </p>
            ) : null}
            {rule.readiness.fieldMapping.optionalMissing.length > 0 ? (
              <p className="mt-1 text-muted-foreground">
                Optional missing:{" "}
                {rule.readiness.fieldMapping.optionalMissing.slice(0, 5).join(", ")}
                {rule.readiness.fieldMapping.optionalMissing.length > 5 ? "…" : ""}
              </p>
            ) : null}
          </div>
        ) : null}

        <GhlConfigDiscoveryPanel
          rule={rule}
          onSaved={(item) => {
            onUpdated?.(item);
            setForm(formFromRule(item));
          }}
        />

        <div className="grid gap-3">
          <p className="text-xs font-medium text-muted-foreground">Advanced manual IDs</p>
          <div className="grid gap-2">
            <Label htmlFor="wf">Workflow ID (GHL)</Label>
            <Input
              id="wf"
              className="font-mono text-xs"
              value={form.destinationWorkflowIdGhl}
              onChange={(e) => setForm({ ...form, destinationWorkflowIdGhl: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pipe">Pipeline ID</Label>
            <Input
              id="pipe"
              className="font-mono text-xs"
              value={form.destinationPipelineIdGhl}
              onChange={(e) => setForm({ ...form, destinationPipelineIdGhl: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="stage">Pipeline stage ID</Label>
            <Input
              id="stage"
              className="font-mono text-xs"
              value={form.destinationPipelineStageIdGhl}
              onChange={(e) => setForm({ ...form, destinationPipelineStageIdGhl: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ghl">GHL connection status</Label>
            <select
              id="ghl"
              className={selectClass}
              value={form.ghlConnectionStatus}
              onChange={(e) => setForm({ ...form, ghlConnectionStatus: e.target.value })}
            >
              <option value="">—</option>
              <option value="connected">connected</option>
              <option value="disconnected">disconnected</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.snapshotInstalled}
              onChange={(e) => setForm({ ...form, snapshotInstalled: e.target.checked })}
            />
            Snapshot installed
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.requiredFieldsInstalled}
              onChange={(e) => setForm({ ...form, requiredFieldsInstalled: e.target.checked })}
            />
            SA360 custom fields installed
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.backupSheetEnabled}
              onChange={(e) => setForm({ ...form, backupSheetEnabled: e.target.checked })}
            />
            Backup sheet enabled
          </label>
          <div className="grid gap-2">
            <Label htmlFor="mode">Delivery mode</Label>
            <select
              id="mode"
              className={selectClass}
              value={form.deliveryMode}
              onChange={(e) => setForm({ ...form, deliveryMode: e.target.value })}
            >
              <option value="shadow">shadow</option>
              <option value="ready_for_live">ready_for_live</option>
              <option value="live">live</option>
              <option value="paused">paused</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.clientCutoverApproved}
              onChange={(e) => setForm({ ...form, clientCutoverApproved: e.target.checked })}
            />
            Client cutover approved
          </label>
          <div className="grid gap-2">
            <Label htmlFor="approval">Internal approval (routing rule)</Label>
            <select
              id="approval"
              className={selectClass}
              value={form.internalApprovalStatus}
              onChange={(e) => setForm({ ...form, internalApprovalStatus: e.target.value })}
            >
              <option value="not_reviewed">not_reviewed</option>
              <option value="ready_for_review">ready_for_review</option>
              <option value="approved">approved</option>
              <option value="blocked">blocked</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Applies to this routing rule only. Source Intake bulk import live canary reads{" "}
              <span className="font-mono">ClientGhlDestination.internalApprovalStatus</span>{" "}
              separately — use the import Approve step admin action there.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.deliveryEnabled}
              onChange={(e) => setForm({ ...form, deliveryEnabled: e.target.checked })}
            />
            Delivery enabled
          </label>
          <label className="flex items-center gap-2 text-sm text-amber-900 dark:text-amber-100">
            <input
              type="checkbox"
              checked={confirmLive}
              onChange={(e) => setConfirmLive(e.target.checked)}
            />
            I understand live delivery risk (no delivery runs in this phase)
          </label>
        </div>

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="button" disabled={pending} onClick={save}>
            {pending ? "Saving…" : "Save delivery config"}
          </Button>
          <Link
            href={buildRoutingDryRunHref({
              masterClientAccountId: rule.masterClientAccountId,
              matched: "all",
              validationStatus: "all",
              reviewQueue: "all",
              limit: 5,
              safeMode: true,
            })}
            className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium"
          >
            Routing dry run (safe mode)
          </Link>
        </div>
    </CocDetailViewShell>
  );
}
