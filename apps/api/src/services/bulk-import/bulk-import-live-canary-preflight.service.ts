import {
  BULK_IMPORT_INITIAL_CANARY_DEMO_CLIENT_ID,
  BULK_IMPORT_INITIAL_CANARY_DEMO_LOCATION_ID,
} from "@sa360/shared";
import { resolveBulkImportInitialCanaryDemoClientId, isBulkImportInitialCanaryDestination } from "../../lib/bulk-import-demo-canary-config.js";
import {
  isDirectDemoDestinationAllowed,
  isDirectLiveDeliveryEnvConfigured,
} from "../../lib/direct-demo-delivery-config.js";
import {
  getGhlDeliveryAdapterMaxMode,
  isGhlAdapterSimulationAllowed,
} from "../../lib/ghl-delivery-adapter-mode.js";
import { redis } from "../../lib/redis.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import { findGhlLocationConnectionByLocationId } from "../../repositories/ghl-location-connection.repository.js";
import { warmEffectiveDeliveryAdapterMode } from "../delivery-runtime-mode.service.js";
import {
  destinationInputFromGhlDestination,
  evaluateDestinationReadiness,
} from "../destination-readiness.service.js";
import { GHL_CONNECTION_CONNECTED } from "../../lib/delivery-readiness-status.js";
import {
  resolveBulkImportCanaryApprovalSources,
  type BulkImportCanaryApprovalSources,
} from "./bulk-import-canary-approval-state.js";
import { loadActiveRoutingRuleApprovalSnapshot } from "./source-intake-live-canary-approval.service.js";
import {
  evaluateBulkImportLiveCanaryRoutingMatch,
  type BulkImportLiveCanaryRoutingMatch,
} from "./bulk-import-live-canary-routing-match.service.js";

export type BulkImportLiveCanaryPreflight = {
  ready: boolean;
  batchId: string;
  deliveryWaveId: string | null;
  destinationClientAccountId: string;
  destinationLocationIdGhl: string;
  expectedDemoClientAccountId: string;
  oauthConnected: boolean;
  destinationReady: boolean;
  adapterMaxMode: string;
  effectiveRuntimeMode: string;
  clientAllowlisted: boolean;
  locationAllowlisted: boolean;
  liveCanaryClientMatch: boolean;
  explicitLiveAllowlistConfigured: boolean;
  cutoverApproved: boolean;
  internalApproval: string;
  internalApprovalSatisfied: boolean;
  envAllowlistedCutoverPending: boolean;
  workerConfigured: boolean;
  queueReachable: boolean;
  approvalSources: BulkImportCanaryApprovalSources;
  routingMatch: BulkImportLiveCanaryRoutingMatch | null;
  blockers: string[];
};

function apiInternalHostnameConfigured(): boolean {
  const url = process.env.SA360_API_INTERNAL_URL?.trim();
  if (!url) return false;
  try {
    return Boolean(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function isQueueReachable(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}

export async function runBulkImportLiveCanaryPreflight(input: {
  batchId: string;
  destinationClientAccountId: string;
  destinationLocationIdGhl: string;
  importOptionsJson: unknown;
  deliveryWaveId?: string | null;
  rowLimit?: number;
  rowIds?: string[];
  requireAllRowsRoutingMatch?: boolean;
}): Promise<BulkImportLiveCanaryPreflight> {
  const destClient = input.destinationClientAccountId.trim();
  const destLocation = input.destinationLocationIdGhl.trim();
  const expectedDemoClientAccountId = resolveBulkImportInitialCanaryDemoClientId();
  const blockers: string[] = [];

  const client = await findClientAccountById(destClient);
  const ghlDest = client?.ghlDestination;
  const connection = destLocation
    ? await findGhlLocationConnectionByLocationId(destLocation)
    : null;

  const oauthConnected =
    connection?.connectionStatus?.toLowerCase() === GHL_CONNECTION_CONNECTED ||
    ghlDest?.ghlConnectionStatus?.toLowerCase() === GHL_CONNECTION_CONNECTED;

  const readiness = ghlDest
    ? evaluateDestinationReadiness(
        destinationInputFromGhlDestination(
          client!,
          ghlDest,
          connection
            ? {
                connectionStatus: connection.connectionStatus,
                lastProbeAt: connection.lastProbeAt,
                lastError: connection.lastError,
              }
            : null
        )
      )
    : null;

  const destinationReady = readiness?.readyForDirectCanary === true;
  const runtime = await warmEffectiveDeliveryAdapterMode();
  const adapterMaxMode = getGhlDeliveryAdapterMaxMode();
  const effectiveRuntimeMode = runtime.effectiveMode;
  const clientAllowlisted = isDirectDemoDestinationAllowed(destClient, destLocation);
  const locationAllowlisted = clientAllowlisted;
  const liveCanaryClientMatch = isBulkImportInitialCanaryDestination(destClient, destLocation);
  const explicitLiveAllowlistConfigured = isDirectLiveDeliveryEnvConfigured();
  const routingRules = destClient ? await loadActiveRoutingRuleApprovalSnapshot(destClient) : [];

  const approvalSources = resolveBulkImportCanaryApprovalSources({
    batchId: input.batchId,
    destinationClientAccountId: destClient,
    importOptionsJson: input.importOptionsJson,
    clientGhlDestinationId: ghlDest?.id ?? null,
    clientCutoverApproved: ghlDest?.clientCutoverApproved === true,
    clientInternalApprovalStatus: ghlDest?.internalApprovalStatus,
    expectedDemoClientAccountId,
    readyForDirectCanary: destinationReady,
    activeRoutingRules: routingRules,
  });

  const cutoverApproved = approvalSources.clientCutoverApproved;
  const internalApproval = approvalSources.internalApprovalStatus;
  const internalApprovalSatisfied = approvalSources.internalApprovalSatisfied;
  const envAllowlistedCutoverPending =
    clientAllowlisted &&
    (!cutoverApproved || !internalApprovalSatisfied);
  const workerConfigured =
    apiInternalHostnameConfigured() && Boolean(process.env.ADMIN_API_KEY?.trim());
  const queueReachable = await isQueueReachable();

  if (approvalSources.destinationClientIdMismatch) {
    blockers.push(approvalSources.destinationClientIdMismatch);
  }
  if (!oauthConnected) {
    blockers.push("OAuth is disconnected.");
  }
  if (!destinationReady) {
    blockers.push("Destination is not ready for direct canary.");
  }
  if (approvalSources.configReadyButCutoverPending) {
    blockers.push(
      "Delivery config is ready for direct canary, but Source Intake client cutover approval has not been granted on ClientGhlDestination."
    );
  }
  if (!isGhlAdapterSimulationAllowed()) {
    blockers.push("Adapter simulation mode is disabled.");
  }
  if (adapterMaxMode !== "live_canary") {
    blockers.push(`Adapter max mode is ${adapterMaxMode}; live_canary is required.`);
  }
  if (effectiveRuntimeMode !== "live_canary") {
    blockers.push(`Effective runtime mode is ${effectiveRuntimeMode}; live_canary is required.`);
  }
  if (!runtime.canRunLiveCanary) {
    blockers.push(runtime.reason || "Live canary runtime is not enabled.");
  }
  if (!clientAllowlisted || !locationAllowlisted) {
    blockers.push("Destination is not on the live delivery allowlist.");
  }
  if (!explicitLiveAllowlistConfigured) {
    blockers.push("Explicit live-delivery environment allowlist is missing.");
  }
  if (!cutoverApproved) {
    blockers.push("Client cutover has not been approved.");
  }
  if (!internalApprovalSatisfied) {
    blockers.push(`Internal approval status is ${internalApproval}; approved is required.`);
  }
  if (!workerConfigured) {
    blockers.push("Worker/API dispatch configuration is unavailable.");
  }
  if (!queueReachable) {
    blockers.push("Bulk import delivery queue is not reachable.");
  }

  let routingMatch: BulkImportLiveCanaryRoutingMatch | null = null;
  if (destClient) {
    routingMatch = await evaluateBulkImportLiveCanaryRoutingMatch({
      batchId: input.batchId,
      destinationClientAccountId: destClient,
      destinationLocationIdGhl: destLocation,
      rowLimit: input.rowIds?.length ? undefined : input.rowLimit,
      rowIds: input.rowIds,
    });
    if (routingMatch.eligibleRowCount === 0) {
      blockers.push(
        "No simulated rows are eligible for live delivery routing validation."
      );
    } else if (
      input.requireAllRowsRoutingMatch !== false &&
      !routingMatch.allEligibleRowsMatch
    ) {
      blockers.push(
        `Live delivery requires each row's attribution to match an active routing rule (${routingMatch.unmatchedRowCount} of ${routingMatch.eligibleRowCount} row(s) unmatched). Update CSV campaign_id (or other match fields) to match an active rule before approving.`
      );
    }
  }

  return {
    ready: blockers.length === 0,
    batchId: input.batchId,
    deliveryWaveId: input.deliveryWaveId ?? null,
    destinationClientAccountId: destClient || expectedDemoClientAccountId,
    destinationLocationIdGhl: destLocation || BULK_IMPORT_INITIAL_CANARY_DEMO_LOCATION_ID,
    expectedDemoClientAccountId,
    oauthConnected,
    destinationReady: destinationReady ?? false,
    adapterMaxMode,
    effectiveRuntimeMode,
    clientAllowlisted,
    locationAllowlisted,
    liveCanaryClientMatch,
    explicitLiveAllowlistConfigured,
    cutoverApproved,
    internalApproval,
    internalApprovalSatisfied,
    envAllowlistedCutoverPending,
    workerConfigured,
    queueReachable,
    approvalSources,
    routingMatch,
    blockers,
  };
}

export async function runBulkImportLiveCanaryPreflightForBatch(
  batch: {
    id: string;
    destinationClientAccountId: string | null;
    destinationLocationIdGhl: string | null;
    importOptionsJson: unknown;
    approvedAt?: Date | null;
  },
  opts?: {
    deliveryWaveId?: string | null;
    rowLimit?: number;
    rowIds?: string[];
    requireAllRowsRoutingMatch?: boolean;
  }
): Promise<BulkImportLiveCanaryPreflight> {
  if (!batch.destinationClientAccountId || !batch.destinationLocationIdGhl) {
    const expectedDemoClientAccountId = resolveBulkImportInitialCanaryDemoClientId();
    const emptySources = resolveBulkImportCanaryApprovalSources({
      batchId: batch.id,
      destinationClientAccountId: "",
      importOptionsJson: batch.importOptionsJson,
      clientGhlDestinationId: null,
      clientCutoverApproved: false,
      clientInternalApprovalStatus: "not_reviewed",
      expectedDemoClientAccountId,
      readyForDirectCanary: false,
      activeRoutingRules: [],
    });
    return {
      ready: false,
      batchId: batch.id,
      deliveryWaveId: opts?.deliveryWaveId ?? null,
      blockers: ["Bulk import destination is not configured."],
      destinationClientAccountId: "",
      destinationLocationIdGhl: "",
      expectedDemoClientAccountId,
      oauthConnected: false,
      destinationReady: false,
      adapterMaxMode: getGhlDeliveryAdapterMaxMode(),
      effectiveRuntimeMode: "simulate",
      clientAllowlisted: false,
      locationAllowlisted: false,
      liveCanaryClientMatch: false,
      explicitLiveAllowlistConfigured: false,
      cutoverApproved: false,
      internalApproval: "not_reviewed",
      internalApprovalSatisfied: false,
      envAllowlistedCutoverPending: false,
      workerConfigured: false,
      queueReachable: false,
      approvalSources: emptySources,
      routingMatch: null,
    };
  }

  return runBulkImportLiveCanaryPreflight({
    batchId: batch.id,
    destinationClientAccountId: batch.destinationClientAccountId,
    destinationLocationIdGhl: batch.destinationLocationIdGhl,
    importOptionsJson: batch.importOptionsJson,
    deliveryWaveId: opts?.deliveryWaveId ?? null,
    rowLimit: opts?.rowLimit,
    rowIds: opts?.rowIds,
    requireAllRowsRoutingMatch: opts?.requireAllRowsRoutingMatch,
  });
}
