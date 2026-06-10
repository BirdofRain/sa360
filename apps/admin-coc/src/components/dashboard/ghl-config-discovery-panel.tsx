"use client";

import { useMemo, useState, useTransition } from "react";

import {
  discoverGhlLocationConfigAction,
  saveRoutingRuleGhlConfigAction,
} from "@/app/actions/ghl-config";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  labelById,
  stagesForPipeline,
} from "@/lib/ghl-config/ghl-config-discovery-display";
import type {
  GhlLocationConfigDiscoveryResponse,
  GhlRequiredFieldsReport,
  Sa360FieldMappingDiscoveryReport,
} from "@/lib/ghl-config/types";
import type { RoutingRuleWithReadinessItem } from "@/lib/delivery-readiness/types";
import {
  readinessStatusBadgeClass,
  readinessStatusLabel,
} from "@/lib/delivery-readiness/delivery-readiness-display";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type SelectionState = {
  pipelineId: string;
  stageId: string;
  workflowId: string;
  userId: string;
  snapshotInstalled: boolean;
  requiredFieldsInstalled: boolean;
  customFieldStampRequired: boolean;
};

function selectionFromRule(rule: RoutingRuleWithReadinessItem): SelectionState {
  return {
    pipelineId: rule.destinationPipelineIdGhl ?? "",
    stageId: rule.destinationPipelineStageIdGhl ?? "",
    workflowId: rule.destinationWorkflowIdGhl ?? "",
    userId: rule.defaultAssignedUserIdGhl ?? "",
    snapshotInstalled: rule.snapshotInstalled,
    requiredFieldsInstalled: rule.requiredFieldsInstalled,
    customFieldStampRequired: rule.readiness.fieldMapping?.customFieldStampRequired ?? false,
  };
}

function Sa360CoreFieldMappingTable({
  mapping,
  savedCoreMapped,
}: {
  mapping: Sa360FieldMappingDiscoveryReport;
  savedCoreMapped?: string[];
}) {
  const coreKeys = [
    ...new Set([
      ...mapping.coreRequiredMapped,
      ...mapping.coreRequiredMissing,
    ]),
  ].sort();
  const optionalPreview = mapping.optionalMissing.slice(0, 4);

  if (coreKeys.length === 0 && mapping.optionalMissing.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No SA360 logical fields detected in GHL custom fields for this location.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="max-h-48 overflow-y-auto rounded-md border border-border text-xs">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left">
              <th className="px-2 py-1">Core logical key</th>
              <th className="px-2 py-1">Discovered</th>
              <th className="px-2 py-1">Saved map</th>
            </tr>
          </thead>
          <tbody>
            {coreKeys.map((key) => {
              const discovered = mapping.coreRequiredMapped.includes(key);
              const saved = Boolean(savedCoreMapped?.includes(key));
              return (
                <tr key={key} className="border-b border-border/60">
                  <td className="px-2 py-1 font-mono">{key}</td>
                  <td className="px-2 py-1">
                    {discovered ? (
                      <span className="text-emerald-700 dark:text-emerald-300">Mapped</span>
                    ) : (
                      <span className="text-amber-800 dark:text-amber-200">Missing</span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {saved ? (
                      <span className="text-emerald-700 dark:text-emerald-300">Yes</span>
                    ) : (
                      <span className="text-amber-800 dark:text-amber-200">No</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {optionalPreview.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Optional unmapped: {optionalPreview.join(", ")}
          {mapping.optionalMissing.length > 4 ? "…" : ""}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {mapping.coreRequiredMapped.length}/{coreKeys.length} core fields discovered ·{" "}
        {mapping.coreRequiredComplete ? "core complete" : "core incomplete"}
      </p>
    </div>
  );
}

function RequiredFieldsTable({ report }: { report: GhlRequiredFieldsReport }) {
  const found = new Set(report.foundRequiredFields);
  const unique = [
    ...new Set([...report.foundRequiredFields, ...report.missingRequiredFields]),
  ];

  if (unique.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No SA360 custom fields detected in this location yet.
      </p>
    );
  }

  return (
    <div className="max-h-40 overflow-y-auto rounded-md border border-border text-xs">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left">
            <th className="px-2 py-1">Field key</th>
            <th className="px-2 py-1">Status</th>
          </tr>
        </thead>
        <tbody>
          {unique.map((key) => (
            <tr key={key} className="border-b border-border/60">
              <td className="px-2 py-1 font-mono">{key}</td>
              <td className="px-2 py-1">
                {found.has(key) ? (
                  <span className="text-emerald-700 dark:text-emerald-300">Found</span>
                ) : (
                  <span className="text-amber-800 dark:text-amber-200">Missing</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GhlConfigDiscoveryPanel({
  rule,
  onSaved,
}: {
  rule: RoutingRuleWithReadinessItem;
  onSaved?: (item: RoutingRuleWithReadinessItem) => void;
}) {
  const locationId = rule.destinationSubaccountIdGhl?.trim() ?? "";
  const [discovery, setDiscovery] = useState<GhlLocationConfigDiscoveryResponse | null>(null);
  const [selection, setSelection] = useState<SelectionState>(() => selectionFromRule(rule));
  const [error, setError] = useState<string | null>(null);
  const [savedItem, setSavedItem] = useState<RoutingRuleWithReadinessItem | null>(null);
  const [pending, startTransition] = useTransition();

  const displayRule = savedItem ?? rule;
  const stages = useMemo(
    () => (discovery ? stagesForPipeline(discovery.pipelines, selection.pipelineId) : []),
    [discovery, selection.pipelineId]
  );

  function discover(refresh = true) {
    if (!locationId) {
      setError("Routing rule has no GHL location ID. Link a connected OAuth location first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await discoverGhlLocationConfigAction(locationId, refresh);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDiscovery(res.discovery);
      setSelection((prev) => ({
        ...prev,
        requiredFieldsInstalled: res.discovery.requiredFields.requiredFieldsInstalled,
      }));
    });
  }

  function saveGhlConfig() {
    if (!locationId) {
      setError("Missing GHL location ID on this routing rule.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await saveRoutingRuleGhlConfigAction(rule.id, {
        locationId,
        destinationPipelineIdGhl: selection.pipelineId || null,
        destinationPipelineStageIdGhl: selection.stageId || null,
        destinationWorkflowIdGhl: selection.workflowId || null,
        defaultAssignedUserIdGhl: selection.userId || null,
        snapshotInstalled: selection.snapshotInstalled,
        requiredFieldsInstalled: selection.requiredFieldsInstalled,
        customFieldStampRequired: selection.customFieldStampRequired,
        sa360CustomFieldIdMapJson: discovery?.sa360FieldMapping.discoveredMap,
        discoveryCustomFields: discovery?.customFields,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSavedItem(res.item);
      setSelection(selectionFromRule(res.item));
      onSaved?.(res.item);
    });
  }

  const pipelineName = discovery
    ? labelById(discovery.pipelines, selection.pipelineId)
    : null;
  const stageName = discovery ? labelById(stages, selection.stageId) : null;
  const workflowName = discovery ? labelById(discovery.workflows, selection.workflowId) : null;
  const userName = discovery ? labelById(discovery.users, selection.userId) : null;

  return (
    <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <div>
        <h3 className="text-sm font-semibold">GHL config discovery</h3>
        <p className="text-xs text-muted-foreground">
          Read-only discovery from connected OAuth location. SA360 field mappings are saved on the
          client destination and shared by all routing rules for this client/location — no GHL
          writes or live delivery.
        </p>
      </div>

      <div className="text-xs text-muted-foreground">
        <div>
          Location:{" "}
          <span className="font-medium text-foreground">
            {discovery?.location.name ?? rule.locationName ?? "—"}
          </span>
        </div>
        <div className="font-mono">{locationId || "—"}</div>
      </div>

      <Button type="button" size="sm" variant="secondary" disabled={pending || !locationId} onClick={() => discover(true)}>
        {pending ? "Discovering…" : discovery ? "Refresh GHL config" : "Discover GHL config"}
      </Button>

      {discovery?.errors.length ? (
        <ul className="list-inside list-disc text-xs text-amber-800 dark:text-amber-200">
          {discovery.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}

      {discovery ? (
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="ghl-pipeline">Pipeline</Label>
            <select
              id="ghl-pipeline"
              className={selectClass}
              value={selection.pipelineId}
              onChange={(e) =>
                setSelection({ ...selection, pipelineId: e.target.value, stageId: "" })
              }
            >
              <option value="">— Select pipeline —</option>
              {discovery.pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ghl-stage">New Lead stage</Label>
            <select
              id="ghl-stage"
              className={selectClass}
              value={selection.stageId}
              disabled={!selection.pipelineId}
              onChange={(e) => setSelection({ ...selection, stageId: e.target.value })}
            >
              <option value="">— Select stage —</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ghl-workflow">First-touch workflow</Label>
            <select
              id="ghl-workflow"
              className={selectClass}
              value={selection.workflowId}
              onChange={(e) => setSelection({ ...selection, workflowId: e.target.value })}
            >
              <option value="">— Select workflow —</option>
              {discovery.workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.status ? ` (${w.status})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ghl-user">Default assigned user (optional)</Label>
            <select
              id="ghl-user"
              className={selectClass}
              value={selection.userId}
              onChange={(e) => setSelection({ ...selection, userId: e.target.value })}
            >
              <option value="">— None —</option>
              {discovery.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.email ? ` · ${u.email}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label>SA360 core field mapping (logical → GHL ID)</Label>
            <Sa360CoreFieldMappingTable
              mapping={discovery.sa360FieldMapping}
              savedCoreMapped={displayRule.readiness.fieldMapping?.coreRequiredMapped}
            />
            <Label className="pt-1">Legacy SA360 field detection</Label>
            <RequiredFieldsTable report={discovery.requiredFields} />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selection.requiredFieldsInstalled}
                onChange={(e) =>
                  setSelection({ ...selection, requiredFieldsInstalled: e.target.checked })
                }
              />
              Mark required SA360 fields installed
              {discovery.requiredFields.requiredFieldsInstalled ? (
                <span className="text-xs text-emerald-700 dark:text-emerald-300">
                  (discovery detected all keys)
                </span>
              ) : (
                <span className="text-xs text-amber-800 dark:text-amber-200">
                  ({discovery.requiredFields.missingRequiredFields.length} missing)
                </span>
              )}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selection.snapshotInstalled}
                onChange={(e) =>
                  setSelection({ ...selection, snapshotInstalled: e.target.checked })
                }
              />
              Snapshot installed
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selection.customFieldStampRequired}
                onChange={(e) =>
                  setSelection({ ...selection, customFieldStampRequired: e.target.checked })
                }
              />
              Require core field mapping for live delivery
            </label>
          </div>

          {(pipelineName || workflowName) && (
            <p className="text-xs text-muted-foreground">
              Selected: {pipelineName ?? selection.pipelineId}
              {stageName ? ` → ${stageName}` : ""}
              {workflowName ? ` · workflow ${workflowName}` : ""}
              {userName ? ` · ${userName}` : ""}
            </p>
          )}
        </div>
      ) : null}

      <Button type="button" size="sm" disabled={pending || !locationId} onClick={saveGhlConfig}>
        {pending ? "Saving…" : "Save delivery config"}
      </Button>

      {savedItem ? (
        <div className="space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Readiness after save:</span>
            <Badge
              variant="outline"
              className={cn("w-fit", readinessStatusBadgeClass(displayRule.readiness.readinessStatus))}
            >
              {readinessStatusLabel(displayRule.readiness.readinessStatus)}
            </Badge>
            {displayRule.readiness.recommendedNextAction ? (
              <span className="text-muted-foreground">{displayRule.readiness.recommendedNextAction}</span>
            ) : null}
          </div>
          {displayRule.readiness.fieldMapping ? (
            <p className="text-muted-foreground">
              Field mapping source: {displayRule.readiness.fieldMapping.source} ·{" "}
              {displayRule.readiness.fieldMapping.coreRequiredMapped.length} core mapped ·{" "}
              {displayRule.readiness.fieldMapping.coreRequiredMissing.length} core missing
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
