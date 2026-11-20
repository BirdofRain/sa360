"use server";

import { adminRequestJson } from "@/lib/admin-api/server";
import { AdminCocForbiddenError, requireStaffWorkspacePermission } from "@/lib/admin-coc-session-guard";
import {
  campaignBindingsPath,
  campaignCollectionPath,
  campaignDestinationPath,
  campaignItemPath,
  closedCampaignCommand,
  interpretCampaignCommand,
  isRegistryCampaignId,
  parseCampaignDetail,
  uncertainCampaignCommand,
  validateBindingDrafts,
  validateCreateDraft,
  validateDestinationDraft,
  validateProfileUpdate,
  type BindingDraftInput,
  type CampaignCommandResult,
  type CampaignDetailView,
} from "@/lib/team-workspace/client-campaign-manager";
import { clientCampaignManagerBlock, isClientCampaignManagerEnabled } from "@/lib/team-workspace/client-campaign-manager-env";
import { isSafeTeamWorkspaceId } from "@/lib/team-workspace/contract";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readClientCampaignAction(input: {
  clientAccountId: string;
  campaignId: string;
}): Promise<{ ok: true; detail: CampaignDetailView } | { ok: false; message: string }> {
  await requireStaffWorkspacePermission("team_workspace");
  if (!isSafeTeamWorkspaceId(input.clientAccountId) || !isRegistryCampaignId(input.campaignId)) {
    return { ok: false, message: "That campaign could not be opened. Nothing was changed." };
  }
  const blocked = clientCampaignManagerBlock();
  if (blocked) {
    return { ok: false, message: "Campaign configuration is not available. Nothing was loaded." };
  }
  const result = await adminRequestJson<unknown>("GET", campaignItemPath(input.clientAccountId, input.campaignId));
  if (!result.ok) return { ok: false, message: "This campaign could not be loaded. Nothing was changed." };
  const detail = parseCampaignDetail(result.data, input.clientAccountId, input.campaignId);
  if (!detail) return { ok: false, message: "This campaign could not be read. Nothing was changed." };
  return { ok: true, detail };
}

export async function createClientCampaignAction(input: {
  clientAccountId: string;
  requestId: string;
  slug: string;
  displayName: string;
  nicheKey: string;
  productType: string;
}): Promise<CampaignCommandResult> {
  await requireStaffWorkspacePermission("team_manager");
  const blocked = await mutationBlocked();
  if (blocked) return blocked;
  const validated = validateCreateDraft(input);
  if (!validated.ok) return closedCampaignCommand("invalid_body", validated.message);
  return postCommand(campaignCollectionPath(input.clientAccountId), validated.body);
}

export async function updateClientCampaignAction(input: {
  clientAccountId: string;
  campaignId: string;
  requestId: string;
  expectedRevision: number;
  displayName: string;
  nicheKey: string;
  productType: string;
  status: string;
}): Promise<CampaignCommandResult> {
  await requireStaffWorkspacePermission("team_manager");
  const blocked = await mutationBlocked();
  if (blocked) return blocked;
  if (!isSafeTeamWorkspaceId(input.clientAccountId)) {
    return closedCampaignCommand("invalid_body", "That client id is not valid. Nothing was saved.");
  }
  const validated = validateProfileUpdate(input);
  if (!validated.ok) return closedCampaignCommand("invalid_body", validated.message);
  return postCommand(campaignItemPath(input.clientAccountId, input.campaignId), validated.body);
}

export async function saveClientCampaignBindingsAction(input: {
  clientAccountId: string;
  campaignId: string;
  requestId: string;
  expectedRevision: number;
  bindings: BindingDraftInput[];
}): Promise<CampaignCommandResult> {
  await requireStaffWorkspacePermission("team_manager");
  const blocked = await mutationBlocked();
  if (blocked) return blocked;
  if (!isSafeTeamWorkspaceId(input.clientAccountId) || !isRegistryCampaignId(input.campaignId)) {
    return closedCampaignCommand("invalid_body", "That campaign could not be saved.");
  }
  if (!UUID.test(input.requestId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    return closedCampaignCommand("invalid_body", "The request could not be checked. Nothing was saved.");
  }
  const validated = validateBindingDrafts(input.bindings);
  if (!validated.ok) return closedCampaignCommand("invalid_body", validated.message);
  return postCommand(campaignBindingsPath(input.clientAccountId, input.campaignId), {
    requestId: input.requestId,
    expectedRevision: input.expectedRevision,
    intent: "save_bindings",
    bindings: validated.bindings,
  });
}

export async function saveClientCampaignDestinationAction(input: {
  clientAccountId: string;
  campaignId: string;
  requestId: string;
  expectedRevision: number;
  workflowIdGhl: string | null;
  workflowTriggerMode: string | null;
  ghlLocationId: string | null;
  spreadsheetId: string | null;
  worksheetId: number | null;
  worksheetTitle: string | null;
}): Promise<CampaignCommandResult> {
  await requireStaffWorkspacePermission("team_manager");
  const blocked = await mutationBlocked();
  if (blocked) return blocked;
  if (!isSafeTeamWorkspaceId(input.clientAccountId) || !isRegistryCampaignId(input.campaignId)) {
    return closedCampaignCommand("invalid_body", "That campaign could not be saved.");
  }
  if (!UUID.test(input.requestId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    return closedCampaignCommand("invalid_body", "The request could not be checked. Nothing was saved.");
  }
  const validated = validateDestinationDraft(input);
  if (!validated.ok) return closedCampaignCommand("invalid_body", validated.message);
  return postCommand(campaignDestinationPath(input.clientAccountId, input.campaignId), {
    requestId: input.requestId,
    expectedRevision: input.expectedRevision,
    intent: "save_destination",
    ...validated.body,
  });
}

async function mutationBlocked(): Promise<CampaignCommandResult | null> {
  if (!isClientCampaignManagerEnabled() || clientCampaignManagerBlock()) {
    return closedCampaignCommand(
      "client_campaign_registry_disabled",
      "Campaign configuration is not available. Nothing was saved.",
      false
    );
  }
  return null;
}

async function postCommand(path: string, body: Record<string, unknown>): Promise<CampaignCommandResult> {
  try {
    const response = await adminRequestJson<unknown>("POST", path, body);
    if (!response.ok) {
      const parsed = parseJson(response.body);
      const command = interpretCampaignCommand(parsed);
      if (command) return command;
      if (response.status === 403) {
        return closedCampaignCommand("forbidden", "This session cannot save campaign configuration. Nothing was saved.");
      }
      if (response.status === 401) {
        return closedCampaignCommand("unauthorized", "Sign in again before saving. Nothing was saved.", false);
      }
      if (transportFailed(response.status, response.body)) {
        return uncertainCampaignCommand(
          "The save did not finish. Retry uses the same request id. Nothing on this page was marked saved."
        );
      }
      return uncertainCampaignCommand("The response could not be read. Retry uses the same request id. Nothing was marked saved.");
    }
    const command = interpretCampaignCommand(response.data);
    if (!command?.stored) {
      return uncertainCampaignCommand("The response could not be confirmed. Nothing was marked saved.");
    }
    return command;
  } catch (error) {
    if (isControlFlow(error)) throw error;
    return uncertainCampaignCommand("The save did not finish. Retry uses the same request id. Nothing on this page was marked saved.");
  }
}

function isControlFlow(error: unknown): boolean {
  if (error instanceof AdminCocForbiddenError) return true;
  const digest = typeof error === "object" && error && "digest" in error ? String((error as { digest?: unknown }).digest) : "";
  return digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK");
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function transportFailed(status: number, body: string): boolean {
  return (
    status === 0 ||
    status >= 500 ||
    body.includes("non-JSON") ||
    body.includes("temporarily unavailable") ||
    body.includes("not configured") ||
    body.startsWith("Admin API request failed")
  );
}
