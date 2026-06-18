import {
  BULK_IMPORT_INITIAL_CANARY_DEMO_CLIENT_ID,
  BULK_IMPORT_INITIAL_CANARY_DEMO_LOCATION_ID,
} from "@sa360/shared";
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

export type BulkImportLiveCanaryPreflight = {
  ready: boolean;
  destinationClientAccountId: string;
  destinationLocationIdGhl: string;
  oauthConnected: boolean;
  destinationReady: boolean;
  adapterMaxMode: string;
  effectiveRuntimeMode: string;
  clientAllowlisted: boolean;
  locationAllowlisted: boolean;
  explicitLiveAllowlistConfigured: boolean;
  cutoverApproved: boolean;
  internalApproval: string;
  workerConfigured: boolean;
  queueReachable: boolean;
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
  destinationClientAccountId: string;
  destinationLocationIdGhl: string;
}): Promise<BulkImportLiveCanaryPreflight> {
  const destClient = input.destinationClientAccountId.trim();
  const destLocation = input.destinationLocationIdGhl.trim();
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
  const explicitLiveAllowlistConfigured = isDirectLiveDeliveryEnvConfigured();
  const cutoverApproved = ghlDest?.clientCutoverApproved === true;
  const internalApproval = ghlDest?.internalApprovalStatus ?? "not_reviewed";
  const workerConfigured =
    apiInternalHostnameConfigured() && Boolean(process.env.ADMIN_API_KEY?.trim());
  const queueReachable = await isQueueReachable();

  if (!oauthConnected) {
    blockers.push("OAuth is disconnected.");
  }
  if (!destinationReady) {
    blockers.push("Destination is not ready for direct canary.");
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
  if (internalApproval !== "approved") {
    blockers.push(`Internal approval status is ${internalApproval}; approved is required.`);
  }
  if (!workerConfigured) {
    blockers.push("Worker/API dispatch configuration is unavailable.");
  }
  if (!queueReachable) {
    blockers.push("Bulk import delivery queue is not reachable.");
  }

  return {
    ready: blockers.length === 0,
    destinationClientAccountId: destClient || BULK_IMPORT_INITIAL_CANARY_DEMO_CLIENT_ID,
    destinationLocationIdGhl: destLocation || BULK_IMPORT_INITIAL_CANARY_DEMO_LOCATION_ID,
    oauthConnected,
    destinationReady: destinationReady ?? false,
    adapterMaxMode,
    effectiveRuntimeMode,
    clientAllowlisted,
    locationAllowlisted,
    explicitLiveAllowlistConfigured,
    cutoverApproved,
    internalApproval,
    workerConfigured,
    queueReachable,
    blockers,
  };
}

export async function runBulkImportLiveCanaryPreflightForBatch(batch: {
  destinationClientAccountId: string | null;
  destinationLocationIdGhl: string | null;
}): Promise<BulkImportLiveCanaryPreflight | { ready: false; blockers: string[] }> {
  if (!batch.destinationClientAccountId || !batch.destinationLocationIdGhl) {
    return {
      ready: false,
      blockers: ["Bulk import destination is not configured."],
      destinationClientAccountId: "",
      destinationLocationIdGhl: "",
      oauthConnected: false,
      destinationReady: false,
      adapterMaxMode: getGhlDeliveryAdapterMaxMode(),
      effectiveRuntimeMode: "simulate",
      clientAllowlisted: false,
      locationAllowlisted: false,
      explicitLiveAllowlistConfigured: false,
      cutoverApproved: false,
      internalApproval: "not_reviewed",
      workerConfigured: false,
      queueReachable: false,
    } as BulkImportLiveCanaryPreflight;
  }

  return runBulkImportLiveCanaryPreflight({
    destinationClientAccountId: batch.destinationClientAccountId,
    destinationLocationIdGhl: batch.destinationLocationIdGhl,
  });
}
