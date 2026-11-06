import type { SupportTicketCategory, SupportTicketContextOverride } from "@/lib/support-tickets/types";

import { TEAM_WORKSPACE_CONTRACT_VERSION, TEAM_WORKSPACE_STEP_IDS, isSafeTeamWorkspaceId, type TeamWorkspaceStepId } from "./contract";
import type { TeamWorkspaceReceipts } from "./types";

const STEP_IDS = new Set<string>(TEAM_WORKSPACE_STEP_IDS);
const FORBIDDEN_KEY = /endpoint|secret|password|token|credential|phone|email|payload|url/i;

export type TeamWorkspaceTicketRequest = {
  contextOverride: SupportTicketContextOverride;
  category: Extract<SupportTicketCategory, "DELIVERY" | "WEBHOOK">;
};

/**
 * Support-ticket context for Team Workspace.
 * Ids only. The existing capture helper adds the page path at submit time.
 */
export function buildTeamWorkspaceTicketContext(input: {
  clientAccountId?: string | null;
  stepId?: TeamWorkspaceStepId | null;
  receipts?: TeamWorkspaceReceipts | null;
}): TeamWorkspaceTicketRequest {
  const clientAccountId = isSafeTeamWorkspaceId(input.clientAccountId) ? input.clientAccountId : null;
  const step = input.stepId && STEP_IDS.has(input.stepId) ? input.stepId : null;
  const receipts = input.receipts ?? {
    sourceLeadEventId: null,
    sheetsJobId: null,
    ghlLiveRunId: null,
    customWebhookAttemptId: null,
  };
  const sourceLeadEventId = isSafeTeamWorkspaceId(receipts.sourceLeadEventId) ? receipts.sourceLeadEventId : null;
  const sheetsJobId = isSafeTeamWorkspaceId(receipts.sheetsJobId) ? receipts.sheetsJobId : null;
  const ghlLiveRunId = isSafeTeamWorkspaceId(receipts.ghlLiveRunId) ? receipts.ghlLiveRunId : null;
  const customWebhookAttemptId = isSafeTeamWorkspaceId(receipts.customWebhookAttemptId)
    ? receipts.customWebhookAttemptId
    : null;

  const teamWorkspace = {
    contractVersion: TEAM_WORKSPACE_CONTRACT_VERSION,
    clientAccountId,
    step,
    sourceLeadEventId,
    sheetsJobId,
    ghlLiveRunId,
    customWebhookAttemptId,
  };

  const related = relatedEntity({ sourceLeadEventId, sheetsJobId, ghlLiveRunId, customWebhookAttemptId });
  const contextOverride: SupportTicketContextOverride = {
    ...(clientAccountId ? { clientAccountId } : {}),
    ...(related ? { relatedEntityType: related.type, relatedEntityId: related.id } : {}),
    contextJson: { teamWorkspace },
  };

  assertNoForbiddenKeys(contextOverride);
  return {
    contextOverride,
    category: customWebhookAttemptId ? "WEBHOOK" : "DELIVERY",
  };
}

function relatedEntity(ids: {
  sourceLeadEventId: string | null;
  sheetsJobId: string | null;
  ghlLiveRunId: string | null;
  customWebhookAttemptId: string | null;
}): { type: string; id: string } | null {
  if (ids.sheetsJobId) return { type: "company_sheets_delivery_job", id: ids.sheetsJobId };
  if (ids.ghlLiveRunId) return { type: "ghl_live_delivery_run", id: ids.ghlLiveRunId };
  if (ids.customWebhookAttemptId) return { type: "custom_webhook_attempt", id: ids.customWebhookAttemptId };
  if (ids.sourceLeadEventId) return { type: "source_lead_event", id: ids.sourceLeadEventId };
  return null;
}

function assertNoForbiddenKeys(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (/endpointUrl|signingSecret|password|token_secret/i.test(serialized)) {
    throw new Error("Team Workspace ticket context rejected a sensitive field");
  }
  walk(value);
}

function walk(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) {
      throw new Error("Team Workspace ticket context rejected a sensitive field");
    }
    walk(child);
  }
}
