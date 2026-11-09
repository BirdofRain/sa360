"use server";

import { requireAdminCocAdminSession, requireAdminCocSession } from "@/lib/admin-coc-session-guard";
import { patchAdminClient, patchAdminClientSetup, postAdminClient } from "@/lib/admin-api/server";
import { isNativeClientSetupEnabled } from "@/lib/clients/native-client-setup-env";
import type { ClientSetup, ClientSetupData } from "@/lib/clients/types";
import { isSafeTeamWorkspaceId } from "@/lib/team-workspace/contract";
import {
  GUIDE_ACCOUNT_STATUSES,
  normalizeProfileList,
  readGuidedFailure,
  sanitizeSetupData,
  validateDraft,
  validateNewClient,
  type GuideAccountStatus,
} from "@/lib/team-workspace/onboarding-guide";

export type GuidedClientMutationResult =
  | { ok: true; clientAccountId: string; clientDisplayName: string }
  | { ok: false; code: string | null; error: string };

export type GuidedSetupSaveResult =
  | {
      ok: true;
      revision: number;
      replayed: boolean;
      status: ClientSetup["status"];
      data: ClientSetupData;
      missingRequiredFields: string[];
      repairRequired: boolean;
    }
  | { ok: false; code: string | null; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(error: string | null | undefined, fallback: string): { ok: false; code: string | null; error: string } {
  const parsed = readGuidedFailure(error ?? fallback);
  return { ok: false, code: parsed.code, error: parsed.message || fallback };
}

function clientIdentity(item: { clientAccountId?: string; clientDisplayName?: string } | null | undefined): GuidedClientMutationResult | null {
  if (!item || !isSafeTeamWorkspaceId(item.clientAccountId) || typeof item.clientDisplayName !== "string") return null;
  const name = item.clientDisplayName.trim();
  if (!name || name.length > 200) return null;
  return { ok: true, clientAccountId: item.clientAccountId, clientDisplayName: name };
}

export async function createGuidedClientAction(input: {
  clientAccountId: string;
  clientDisplayName: string;
  primaryNicheKeys: string[];
  primaryProductTypes: string[];
}): Promise<GuidedClientMutationResult> {
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  const clientAccountId = input.clientAccountId.trim();
  const clientDisplayName = input.clientDisplayName.trim();
  const errors = validateNewClient({ clientAccountId, clientDisplayName });
  if (errors.length > 0) return { ok: false, code: "VALIDATION", error: errors[0]?.message ?? "Check the client name and id." };
  const res = await postAdminClient({
    clientAccountId,
    clientDisplayName,
    status: "onboarding",
    primaryNicheKeys: normalizeProfileList(input.primaryNicheKeys),
    primaryProductTypes: normalizeProfileList(input.primaryProductTypes),
  });
  const identity = clientIdentity(res.data?.item);
  if (!identity || res.error) return failure(res.error, "The client could not be created.");
  return identity;
}

export async function updateGuidedClientAction(input: {
  clientAccountId: string;
  clientDisplayName: string;
  status: GuideAccountStatus;
  primaryNicheKeys: string[];
  primaryProductTypes: string[];
}): Promise<GuidedClientMutationResult> {
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  if (!isSafeTeamWorkspaceId(input.clientAccountId)) {
    return { ok: false, code: "VALIDATION", error: "That client id is not valid." };
  }
  const clientDisplayName = input.clientDisplayName.trim();
  if (!clientDisplayName || clientDisplayName.length > 200) {
    return { ok: false, code: "VALIDATION", error: "Enter the client name." };
  }
  if (!GUIDE_ACCOUNT_STATUSES.includes(input.status)) {
    return { ok: false, code: "VALIDATION", error: "Choose an account status. This does not turn delivery on." };
  }
  const res = await patchAdminClient(input.clientAccountId, {
    clientDisplayName,
    status: input.status,
    primaryNicheKeys: normalizeProfileList(input.primaryNicheKeys),
    primaryProductTypes: normalizeProfileList(input.primaryProductTypes),
  });
  const identity = clientIdentity(res.data?.item);
  if (!identity || res.error) return failure(res.error, "The client information could not be saved.");
  return identity;
}

export async function saveGuidedSetupAction(input: {
  clientAccountId: string;
  data: ClientSetupData;
  requestId: string;
  expectedRevision: number;
}): Promise<GuidedSetupSaveResult> {
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  if (!isSafeTeamWorkspaceId(input.clientAccountId)) {
    return { ok: false, code: "VALIDATION", error: "That client id is not valid." };
  }
  if (!isNativeClientSetupEnabled()) {
    return {
      ok: false,
      code: "FEATURE_DISABLED",
      error: "Saving a setup request is unavailable. Native client setup is turned off.",
    };
  }
  if (!UUID.test(input.requestId) || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    return { ok: false, code: "VALIDATION", error: "This save is missing a request id or revision. Reload and try again." };
  }
  const data = sanitizeSetupData(input.data);
  const draftErrors = validateDraft(
    {
      clientDisplayName: "saved",
      accountStatus: "onboarding",
      primaryNicheKeys: [],
      primaryProductTypes: [],
      clientEmail: typeof data.clientEmail === "string" ? data.clientEmail : "",
      clientPhone: typeof data.clientPhone === "string" ? data.clientPhone : "",
      geography: typeof data.geography === "string" ? data.geography : "",
      sourceProvider: data.sourceProvider ?? "",
      trafficSourceName: typeof data.trafficSourceName === "string" ? data.trafficSourceName : "",
      providerFunnelId: typeof data.providerFunnelId === "string" ? data.providerFunnelId : "",
      providerCampaignId: typeof data.providerCampaignId === "string" ? data.providerCampaignId : "",
      sourceMissingInfoNotes: typeof data.sourceMissingInfoNotes === "string" ? data.sourceMissingInfoNotes : "",
      destinationChoice: data.destinationChoice ?? "",
    },
    "setup"
  );
  if (draftErrors.length > 0) return { ok: false, code: "VALIDATION", error: draftErrors[0]?.message ?? "Check the setup request." };
  const res = await patchAdminClientSetup(input.clientAccountId, {
    requestId: input.requestId,
    expectedRevision: input.expectedRevision,
    intent: "save_draft",
    data,
  });
  const item = res.data?.item;
  if (!res.data || res.error || !item) return failure(res.error, "The setup request could not be saved.");
  if (item.operationalEffects !== false) {
    return {
      ok: false,
      code: "OPERATIONAL_EFFECT",
      error: "The setup response was not a request-only save. Reload the client before trying again.",
    };
  }
  const status = item.status;
  if (status !== "draft" && status !== "submitted" && status !== "needs_information" && status !== "setup_reviewed") {
    return { ok: false, code: "VALIDATION", error: "The setup response could not be read. Reload and try again." };
  }
  if (!Number.isInteger(item.revision) || item.revision < 0) {
    return { ok: false, code: "VALIDATION", error: "The setup response did not include a revision. Reload and try again." };
  }
  return {
    ok: true,
    revision: item.revision,
    replayed: res.data.replayed === true,
    status,
    data: sanitizeSetupData(item.data),
    missingRequiredFields: Array.isArray(item.missingRequiredFields)
      ? item.missingRequiredFields.filter((field) => typeof field === "string").slice(0, 24)
      : [],
    repairRequired: item.repairRequired === true,
  };
}
