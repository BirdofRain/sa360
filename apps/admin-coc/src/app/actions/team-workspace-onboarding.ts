"use server";

import { AdminCocForbiddenError, requireAdminCocAdminSession, requireAdminCocSession } from "@/lib/admin-coc-session-guard";
import { fetchAdminClientDetail, patchAdminClient, patchAdminClientSetup, postAdminClient } from "@/lib/admin-api/server";
import { isNativeClientSetupEnabled } from "@/lib/clients/native-client-setup-env";
import type { ClientSetup, ClientSetupData } from "@/lib/clients/types";
import { isTeamWorkspaceEnabled } from "@/lib/team-workspace/config";
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

function workspaceUnavailable(): { ok: false; code: "FEATURE_DISABLED"; error: string } | null {
  if (isTeamWorkspaceEnabled()) return null;
  return {
    ok: false,
    code: "FEATURE_DISABLED",
    error: "Team Workspace is turned off. Nothing was changed, and delivery was not turned on.",
  };
}

function isControlFlow(error: unknown): boolean {
  if (error instanceof AdminCocForbiddenError) return true;
  const digest = typeof error === "object" && error && "digest" in error ? String((error as { digest?: unknown }).digest) : "";
  return digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK");
}

function uncertain(message: string): { ok: false; code: "UNCERTAIN"; error: string } {
  return { ok: false, code: "UNCERTAIN", error: message };
}

function isConflict(error: string | null | undefined): boolean {
  if (!error) return false;
  return readGuidedFailure(error).code === "CONFLICT" || /already in use/i.test(error);
}

function isUncertainTransport(error: string | null | undefined): boolean {
  if (!error) return true;
  return error.startsWith("Admin API request failed") || error.includes("temporarily unavailable") || error.includes("non-JSON");
}

async function readExistingClient(clientAccountId: string, clientDisplayName: string): Promise<"absent" | "different" | "uncertain" | GuidedClientMutationResult> {
  try {
    const res = await fetchAdminClientDetail(clientAccountId);
    if (!res.data?.item) {
      if (!res.error || /Admin API error \(404\)|not found/i.test(res.error)) return "absent";
      return "uncertain";
    }
    const identity = clientIdentity(res.data.item);
    if (!identity || !identity.ok) return "uncertain";
    if (identity.clientDisplayName !== clientDisplayName) return "different";
    return identity;
  } catch (error) {
    if (isControlFlow(error)) throw error;
    return "uncertain";
  }
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
  const closed = workspaceUnavailable();
  if (closed) return closed;
  try {
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
    if (identity?.ok && !res.error) return identity;
    if (isConflict(res.error) || isUncertainTransport(res.error)) {
      const existing = await readExistingClient(clientAccountId, clientDisplayName);
      if (typeof existing === "object") return existing;
      if (isConflict(res.error)) {
        return failure(res.error, "That client account ID is already in use. Choose a different ID.");
      }
      return uncertain(
        "The create request did not finish. Try the same client id again, or reload the list if that client is already there. Delivery was not turned on."
      );
    }
    return failure(res.error, "The client could not be created.");
  } catch (error) {
    if (isControlFlow(error)) throw error;
    return uncertain(
      "The create request did not finish. Try the same client id again, or reload the list if that client is already there. Delivery was not turned on."
    );
  }
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
  const closed = workspaceUnavailable();
  if (closed) return closed;
  try {
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
    if (identity?.ok && !res.error) return identity;
    if (isUncertainTransport(res.error)) {
      return uncertain("Saving client information did not finish. Try again. Delivery was not turned on.");
    }
    return failure(res.error, "The client information could not be saved.");
  } catch (error) {
    if (isControlFlow(error)) throw error;
    return uncertain("Saving client information did not finish. Try again. Delivery was not turned on.");
  }
}

export async function saveGuidedSetupAction(input: {
  clientAccountId: string;
  data: ClientSetupData;
  requestId: string;
  expectedRevision: number;
}): Promise<GuidedSetupSaveResult> {
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  const closed = workspaceUnavailable();
  if (closed) return closed;
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
  try {
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
    if (!res.data || res.error || !item) {
      if (isUncertainTransport(res.error)) {
        return uncertain("The setup save did not finish. Try this save again. The same request is reused, and delivery was not turned on.");
      }
      return failure(res.error, "The setup request could not be saved.");
    }
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
  } catch (error) {
    if (isControlFlow(error)) throw error;
    return uncertain("The setup save did not finish. Try this save again. The same request is reused, and delivery was not turned on.");
  }
}
