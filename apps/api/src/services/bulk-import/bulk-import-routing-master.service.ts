import { listActiveCampaignRoutingRules, listCampaignRoutingRules } from "../../repositories/campaign-routing-rule.repository.js";

const DEFAULT_MASTER_ENV_KEYS = [
  "SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID",
  "NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID",
] as const;

export function readDefaultRoutingMasterClientAccountId(): string | null {
  for (const key of DEFAULT_MASTER_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return null;
}

/**
 * Campaign routing rules are keyed by masterClientAccountId (e.g. lal_master_vet),
 * not destination clientAccountId (e.g. smart_agent_360_demo_2).
 */
export async function resolveRoutingMasterClientAccountIdForDestination(
  destinationClientAccountId: string
): Promise<string> {
  const destination = destinationClientAccountId.trim();
  if (!destination) return readDefaultRoutingMasterClientAccountId() ?? "";

  const rulesForDestination = await listCampaignRoutingRules({
    clientAccountId: destination,
    active: true,
  });
  if (rulesForDestination.length > 0) {
    return rulesForDestination[0]!.masterClientAccountId;
  }

  return readDefaultRoutingMasterClientAccountId() ?? destination;
}

export async function listActiveRoutingRulesForBulkImportDelivery(input: {
  destinationClientAccountId: string;
  destinationLocationIdGhl?: string | null;
}) {
  const destinationClientAccountId = input.destinationClientAccountId.trim();
  const destinationLocationIdGhl = input.destinationLocationIdGhl?.trim();

  const scopedRules = await listCampaignRoutingRules({
    clientAccountId: destinationClientAccountId,
    destinationSubaccountIdGhl: destinationLocationIdGhl || undefined,
    active: true,
  });
  if (scopedRules.length > 0) return scopedRules;

  const destinationRules = await listCampaignRoutingRules({
    clientAccountId: destinationClientAccountId,
    active: true,
  });
  if (destinationRules.length > 0) return destinationRules;

  const masterClientAccountId =
    await resolveRoutingMasterClientAccountIdForDestination(destinationClientAccountId);
  if (!masterClientAccountId) return [];
  return listActiveCampaignRoutingRules(masterClientAccountId);
}

export function getSourceImportBatchIdFromRouting(routing: unknown): string | undefined {
  if (!routing || typeof routing !== "object" || Array.isArray(routing)) {
    return undefined;
  }
  const sourceIntake = (routing as Record<string, unknown>).source_intake;
  if (!sourceIntake || typeof sourceIntake !== "object" || Array.isArray(sourceIntake)) {
    return undefined;
  }
  const batchId = (sourceIntake as Record<string, unknown>).sourceImportBatchId;
  if (typeof batchId !== "string") return undefined;
  const trimmed = batchId.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isBulkImportLifecyclePayload(payload: {
  routing?: unknown;
}): boolean {
  return Boolean(getSourceImportBatchIdFromRouting(payload.routing));
}

/**
 * Live delivery re-runs campaign routing dry-run. Bulk import rows must use the
 * routing master client id for rule lookup, not the operator-selected destination id.
 */
export async function prepareBulkImportPayloadForRoutingDryRun<T extends { client_account_id: string }>(
  payload: T,
  destinationClientAccountId: string,
  deps: {
    resolveRoutingMasterClientAccountIdForDestination?: typeof resolveRoutingMasterClientAccountIdForDestination;
  } = {}
): Promise<T> {
  const resolveMaster =
    deps.resolveRoutingMasterClientAccountIdForDestination ??
    resolveRoutingMasterClientAccountIdForDestination;
  const masterClientAccountId = await resolveMaster(destinationClientAccountId);
  if (!masterClientAccountId || masterClientAccountId === payload.client_account_id.trim()) {
    return payload;
  }
  return {
    ...payload,
    client_account_id: masterClientAccountId,
  };
}
