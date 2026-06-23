import { BULK_IMPORT_INITIAL_CANARY_MAX_ROWS } from "@sa360/shared";
import { isBulkImportInitialCanaryDestination } from "../../lib/bulk-import-demo-canary-config.js";
import { isDirectDemoDestinationAllowed } from "../../lib/direct-demo-delivery-config.js";
import { findBulkLeadImportById, updateBulkLeadImport } from "../../repositories/bulk-lead-import.repository.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import { listCampaignRoutingRules } from "../../repositories/campaign-routing-rule.repository.js";
import { warmEffectiveDeliveryAdapterMode } from "../delivery-runtime-mode.service.js";
import { patchClientGhlDestinationAdmin } from "../client-account.service.js";
import {
  mergeBatchInternalApprovalApproved,
  readBatchInternalApprovalStatus,
} from "./bulk-import-canary-approval-state.js";

const DEMO_CANARY_CLIENT_ID = "smart_agent_360_demo_2";

export type ApproveSourceIntakeClientCutoverResult =
  | {
      ok: true;
      clientAccountId: string;
      destinationLocationIdGhl: string;
      clientCutoverApproved: true;
      clientGhlDestinationId: string;
    }
  | { notFound: true }
  | { ok: false; error: string; code: "NOT_ALLOWLISTED" | "NO_DESTINATION" | "ALREADY_APPROVED" };

export type ApproveSourceIntakeBatchInternalReviewResult =
  | {
      ok: true;
      batchId: string;
      destinationClientAccountId: string;
      internalApprovalStatus: "approved";
      internalApprovalSource: "ClientGhlDestination";
      clientGhlDestinationId: string;
    }
  | { notFound: true }
  | {
      ok: false;
      error: string;
      code:
        | "NOT_DEMO_DESTINATION"
        | "NOT_ALLOWLISTED"
        | "RUNTIME_NOT_LIVE_CANARY"
        | "WAVE_TOO_LARGE"
        | "NO_DESTINATION"
        | "ALREADY_APPROVED";
    };

function isDemoCanaryClient(clientAccountId: string, locationIdGhl: string): boolean {
  const client = clientAccountId.trim();
  const location = locationIdGhl.trim();
  return (
    client === DEMO_CANARY_CLIENT_ID ||
    isBulkImportInitialCanaryDestination(client, location)
  );
}

export async function approveSourceIntakeClientCutover(
  clientAccountId: string
): Promise<ApproveSourceIntakeClientCutoverResult> {
  const client = await findClientAccountById(clientAccountId.trim());
  if (!client) return { notFound: true };

  const dest = client.ghlDestination;
  const locationId = dest?.destinationSubaccountIdGhl?.trim();
  if (!dest || !locationId) {
    return {
      ok: false,
      error: "Client has no GHL destination configured.",
      code: "NO_DESTINATION",
    };
  }

  if (!isDirectDemoDestinationAllowed(client.clientAccountId, locationId)) {
    return {
      ok: false,
      error:
        "Client/location is not on the live delivery environment allowlist. Broad live delivery cannot be approved through this action.",
      code: "NOT_ALLOWLISTED",
    };
  }

  if (dest.clientCutoverApproved === true) {
    return {
      ok: false,
      error: "Client cutover approval is already set for this client destination.",
      code: "ALREADY_APPROVED",
    };
  }

  const patchResult = await patchClientGhlDestinationAdmin(client.clientAccountId, {
    clientCutoverApproved: true,
  });

  if ("notFound" in patchResult) return { notFound: true };
  if ("error" in patchResult) {
    return { ok: false, error: patchResult.error, code: "NOT_ALLOWLISTED" };
  }

  return {
    ok: true,
    clientAccountId: client.clientAccountId,
    destinationLocationIdGhl: locationId,
    clientCutoverApproved: true,
    clientGhlDestinationId: dest.id,
  };
}

export async function approveSourceIntakeBatchInternalReview(input: {
  batchId: string;
  rowLimit: number;
}): Promise<ApproveSourceIntakeBatchInternalReviewResult> {
  const batch = await findBulkLeadImportById(input.batchId.trim());
  if (!batch) return { notFound: true };

  const destClient = batch.destinationClientAccountId?.trim();
  const destLocation = batch.destinationLocationIdGhl?.trim();
  if (!destClient || !destLocation) {
    return {
      ok: false,
      error: "Bulk import destination is not configured.",
      code: "NO_DESTINATION",
    };
  }

  if (!isDemoCanaryClient(destClient, destLocation)) {
    return {
      ok: false,
      error: "Internal review approval is limited to the SA360 Demo canary destination.",
      code: "NOT_DEMO_DESTINATION",
    };
  }

  if (!isDirectDemoDestinationAllowed(destClient, destLocation)) {
    return {
      ok: false,
      error: "Destination is not on the live delivery environment allowlist.",
      code: "NOT_ALLOWLISTED",
    };
  }

  const runtime = await warmEffectiveDeliveryAdapterMode();
  if (runtime.effectiveMode !== "live_canary") {
    return {
      ok: false,
      error: `Effective runtime mode is ${runtime.effectiveMode}; live_canary is required.`,
      code: "RUNTIME_NOT_LIVE_CANARY",
    };
  }

  const waveLimit = Math.max(1, Math.floor(input.rowLimit));
  if (waveLimit > BULK_IMPORT_INITIAL_CANARY_MAX_ROWS) {
    return {
      ok: false,
      error: `Initial live canary allows at most ${BULK_IMPORT_INITIAL_CANARY_MAX_ROWS} row per approval.`,
      code: "WAVE_TOO_LARGE",
    };
  }

  const client = await findClientAccountById(destClient);
  const clientDest = client?.ghlDestination;
  if (clientDest?.internalApprovalStatus === "approved") {
    return {
      ok: false,
      error: "Client destination internal approval is already set.",
      code: "ALREADY_APPROVED",
    };
  }

  if (readBatchInternalApprovalStatus(batch.importOptionsJson) === "approved") {
    return {
      ok: false,
      error: "Internal review is already approved for this import canary.",
      code: "ALREADY_APPROVED",
    };
  }

  const patchResult = await patchClientGhlDestinationAdmin(destClient, {
    internalApprovalStatus: "approved",
  });
  if ("notFound" in patchResult) return { notFound: true };
  if ("error" in patchResult) {
    return {
      ok: false,
      error: patchResult.error,
      code: "NOT_ALLOWLISTED",
    };
  }

  await updateBulkLeadImport(batch.id, {
    importOptionsJson: mergeBatchInternalApprovalApproved(batch.importOptionsJson),
  });

  const refreshed = await findClientAccountById(destClient);
  const destId = refreshed?.ghlDestination?.id ?? clientDest?.id ?? "";

  return {
    ok: true,
    batchId: batch.id,
    destinationClientAccountId: destClient,
    internalApprovalStatus: "approved",
    internalApprovalSource: "ClientGhlDestination",
    clientGhlDestinationId: destId,
  };
}

/** @deprecated Prefer approveSourceIntakeClientCutover + approveSourceIntakeBatchInternalReview. */
export async function approveSourceIntakeLiveCanaryForClient(clientAccountId: string) {
  const cutover = await approveSourceIntakeClientCutover(clientAccountId);
  if (!("ok" in cutover) || !cutover.ok) return cutover;

  const client = await findClientAccountById(clientAccountId.trim());
  const dest = client?.ghlDestination;
  if (!dest) return { notFound: true as const };

  if (dest.internalApprovalStatus === "approved") {
    return {
      ok: true as const,
      clientAccountId,
      destinationLocationIdGhl: cutover.destinationLocationIdGhl,
      clientCutoverApproved: true as const,
      internalApprovalStatus: "approved" as const,
    };
  }

  const patchResult = await patchClientGhlDestinationAdmin(clientAccountId, {
    internalApprovalStatus: "approved",
  });
  if ("notFound" in patchResult) return { notFound: true as const };
  if ("error" in patchResult) {
    return { ok: false as const, error: patchResult.error, code: "NOT_ALLOWLISTED" as const };
  }

  return {
    ok: true as const,
    clientAccountId,
    destinationLocationIdGhl: cutover.destinationLocationIdGhl,
    clientCutoverApproved: true as const,
    internalApprovalStatus: "approved" as const,
  };
}

export async function loadActiveRoutingRuleApprovalSnapshot(clientAccountId: string) {
  const rules = await listCampaignRoutingRules({ clientAccountId });
  return rules
    .filter((rule) => rule.active)
    .map((rule) => ({
      id: rule.id,
      clientCutoverApproved: rule.clientCutoverApproved,
      internalApprovalStatus: rule.internalApprovalStatus,
    }));
}
