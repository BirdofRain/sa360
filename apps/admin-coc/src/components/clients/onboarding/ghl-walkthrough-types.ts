import type { RoutingRuleGhlConfigSaveBody } from "@/lib/ghl-config/types";
import type { GhlLocationConfigDiscoveryResponse } from "@/lib/ghl-config/types";
import type { GhlPreviewFieldMapping, GhlPreviewStep } from "@/lib/clients/onboarding/ghl-delivery-preview";

/** Destination switch only. Does not create a plan or send a lead. */
export function ongoingGhlDeliveryPatch(enabled: boolean): Record<string, unknown> {
  if (!enabled) return { deliveryEnabled: false };
  return {
    deliveryEnabled: true,
    deliveryMode: "live",
    clientCutoverApproved: true,
    internalApprovalStatus: "approved",
    confirmLiveDeliveryRisk: true,
  };
}

/** Typed by the operator before the destination switch is turned on. */
export const ONGOING_GHL_ENABLE_CONFIRMATION = "ENABLE ONGOING GHL DELIVERY";

/** Typed by the operator before ongoing GHL delivery is paused. */
export const ONGOING_GHL_PAUSE_CONFIRMATION = "PAUSE ONGOING GHL DELIVERY";

export type GhlWalkthroughLocation = {
  locationId: string | null;
  locationName: string | null;
  workflowId: string | null;
  workflowTriggerMode: string | null;
  deliveryEnabled: boolean | null;
  opportunityCreationEnabled: boolean | null;
  pipelineId: string | null;
  stageId: string | null;
};

export type GhlWalkthroughConnection = {
  id: string;
  locationId: string;
  locationName: string | null;
  clientAccountId: string | null;
  connectionStatus: string;
};

export type GhlWalkthroughPreview = {
  planId: string;
  runId: string | null;
  steps: GhlPreviewStep[];
  fieldMapping: GhlPreviewFieldMapping | null;
  deliveryEnabled: boolean | null;
};

export type GhlWalkthroughPreflight = {
  canExecute: boolean;
  blockers: string[];
  duplicateRiskLevel: string | null;
  duplicateBlocksLive: boolean;
  lastLiveRunStatus: string | null;
};

export type GhlWalkthroughExecution = {
  status: string;
  contactIdGhl: string | null;
  opportunityIdGhl: string | null;
  workflowStarted: boolean | null;
  externalCallExecuted: boolean;
  errors: string[];
  skippedDuplicate: boolean;
};

export type GhlWalkthroughActions = {
  loadConnections: () => Promise<{ ok: true; items: GhlWalkthroughConnection[] } | { ok: false; error: string }>;
  linkLocation: (connectionId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  startConnect: () => Promise<{ ok: true; authorizeUrl: string } | { ok: false; error: string }>;
  discover: (
    locationId: string
  ) => Promise<{ ok: true; discovery: GhlLocationConfigDiscoveryResponse } | { ok: false; error: string }>;
  saveWorkflow: (
    body: RoutingRuleGhlConfigSaveBody
  ) => Promise<
    | { ok: true; deliveryEnabled: boolean | null; workflowTriggerMode: string | null; workflowId: string | null }
    | { ok: false; error: string }
  >;
  previewDelivery: (decisionId: string) => Promise<{ ok: true; preview: GhlWalkthroughPreview } | { ok: false; error: string }>;
  loadPreflight: (planId: string) => Promise<{ ok: true; preflight: GhlWalkthroughPreflight } | { ok: false; error: string }>;
  executeTest: (
    planId: string,
    confirmation: string
  ) => Promise<
    | { ok: true; result: GhlWalkthroughExecution }
    | { ok: false; error: string; blockers?: string[]; result?: GhlWalkthroughExecution }
  >;
  setOngoingDelivery: (
    enabled: boolean
  ) => Promise<{ ok: true; deliveryEnabled: boolean } | { ok: false; error: string }>;
};
