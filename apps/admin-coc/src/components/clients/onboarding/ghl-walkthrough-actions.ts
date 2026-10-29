import { discoverGhlLocationConfigAction, saveClientGhlConfigAction } from "@/app/actions/ghl-config";
import { linkGhlConnectionClientAction, loadGhlConnectionsAction, startGhlOAuthConnectAction } from "@/app/actions/ghl-connections";
import { executeGhlLiveCanaryAction, loadGhlLiveCanaryPreflightAction } from "@/app/actions/ghl-live-canary";
import { simulateGhlAdapterAction } from "@/app/actions/ghl-adapter";
import { generateDeliveryPlanAction } from "@/app/actions/routing-dry-run";
import type { GhlPreviewStep } from "@/lib/clients/onboarding/ghl-delivery-preview";
import { formatRoutingDryRunActionError } from "@/lib/routing-dry-run/routing-dry-run-action.util";
import type { GhlLiveDeliveryRunItem } from "@/lib/ghl-live-canary/types";

import type { GhlWalkthroughActions, GhlWalkthroughConnection, GhlWalkthroughExecution } from "./ghl-walkthrough-types";

function executionFromRun(
  run: GhlLiveDeliveryRunItem | undefined,
  extra: {
    contactIdGhl: string | null;
    opportunityIdGhl: string | null;
    workflowStarted: boolean | null;
    externalCallExecuted: boolean;
    skippedDuplicate: boolean;
  }
): GhlWalkthroughExecution | undefined {
  if (!run) return undefined;
  return {
    status: run.status,
    contactIdGhl: extra.contactIdGhl,
    opportunityIdGhl: extra.opportunityIdGhl,
    workflowStarted: extra.workflowStarted,
    externalCallExecuted: extra.externalCallExecuted,
    errors: run.errors,
    skippedDuplicate: extra.skippedDuplicate,
  };
}

function asSteps(value: unknown): GhlPreviewStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.stepType !== "string") return [];
    return [
      {
        stepType: row.stepType,
        status: typeof row.status === "string" ? row.status : "unknown",
        targetId: typeof row.targetId === "string" ? row.targetId : null,
        title: typeof row.title === "string" ? row.title : row.stepType,
        requestPreviewJson: row.requestPreviewJson ?? null,
        validationErrors: Array.isArray(row.validationErrors)
          ? row.validationErrors.filter((entry): entry is string => typeof entry === "string")
          : [],
        warnings: Array.isArray(row.warnings) ? row.warnings.filter((entry): entry is string => typeof entry === "string") : [],
      },
    ];
  });
}

export function liveGhlWalkthroughActions(clientAccountId: string): GhlWalkthroughActions {
  return {
    loadConnections: async () => {
      const res = await loadGhlConnectionsAction();
      if (!res.ok) return { ok: false, error: res.error };
      const items: GhlWalkthroughConnection[] = res.items.map((item) => ({
        id: item.id,
        locationId: item.locationId,
        locationName: item.locationName,
        clientAccountId: item.clientAccountId,
        connectionStatus: item.connectionStatus,
      }));
      return { ok: true, items };
    },
    linkLocation: async (connectionId) => {
      const res = await linkGhlConnectionClientAction(connectionId, clientAccountId);
      if (!res.ok) return { ok: false, error: res.error ?? "Link failed." };
      return { ok: true };
    },
    startConnect: async () => {
      const res = await startGhlOAuthConnectAction(clientAccountId, `/clients/${encodeURIComponent(clientAccountId)}/onboarding`);
      if (!res.ok) return res;
      return { ok: true, authorizeUrl: res.authorizeUrl };
    },
    discover: async (locationId) => discoverGhlLocationConfigAction(locationId, true),
    saveWorkflow: async (body) => {
      const res = await saveClientGhlConfigAction(clientAccountId, body);
      if (!res.ok) return { ok: false, error: res.error };
      const destination = res.ghlDestination;
      return {
        ok: true,
        deliveryEnabled: destination?.deliveryEnabled ?? null,
        workflowTriggerMode: destination?.workflowTriggerMode ?? body.workflowTriggerMode ?? null,
        workflowId: destination?.destinationWorkflowIdGhl ?? body.destinationWorkflowIdGhl ?? null,
      };
    },
    previewDelivery: async (decisionId) => {
      const plan = await generateDeliveryPlanAction(decisionId);
      if (!plan.ok) return { ok: false, error: formatRoutingDryRunActionError(plan.error) };
      const simulated = await simulateGhlAdapterAction(plan.plan.id);
      const run = simulated.adapterRun;
      if (!run) return { ok: false, error: simulated.ok ? "Simulation did not return a run." : simulated.error };
      return {
        ok: true,
        preview: {
          planId: plan.plan.id,
          runId: run.id,
          steps: asSteps(run.stepRuns),
          fieldMapping: null,
          deliveryEnabled: null,
        },
      };
    },
    loadPreflight: async (planId) => {
      const res = await loadGhlLiveCanaryPreflightAction(planId);
      if (!res.ok) return { ok: false, error: res.error };
      const preflight = res.preflight.preflight;
      return {
        ok: true,
        preflight: {
          canExecute: preflight.canExecute,
          blockers: preflight.blockers,
          duplicateRiskLevel: preflight.duplicateRiskLevel,
          duplicateBlocksLive: preflight.duplicateBlocksLive,
          lastLiveRunStatus: preflight.lastLiveRunStatus,
        },
      };
    },
    executeTest: async (planId, confirmation) => {
      const res = await executeGhlLiveCanaryAction(planId, confirmation);
      if (!res.ok) {
        return {
          ok: false,
          error: res.error,
          blockers: res.blockers,
          result: executionFromRun(res.liveRun, {
            contactIdGhl: res.liveRun?.contactIdGhl ?? null,
            opportunityIdGhl: res.liveRun?.opportunityIdGhl ?? null,
            workflowStarted: res.liveRun?.workflowStarted ?? null,
            externalCallExecuted: false,
            skippedDuplicate: res.skippedDuplicate === true || res.liveRun?.status === "skipped_duplicate",
          }),
        };
      }
      return {
        ok: true,
        result: executionFromRun(res.liveRun, {
          contactIdGhl: res.contactIdGhl,
          opportunityIdGhl: res.opportunityIdGhl,
          workflowStarted: res.workflowStarted,
          externalCallExecuted: res.externalCallExecuted,
          skippedDuplicate: res.liveRun.status === "skipped_duplicate",
        })!,
      };
    },
  };
}
