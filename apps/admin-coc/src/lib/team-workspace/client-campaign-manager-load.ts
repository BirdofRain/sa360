import "server-only";

import { adminFetchJson } from "@/lib/admin-api/server";
import { requireStaffWorkspacePermission } from "@/lib/admin-coc-session-guard";

import {
  campaignCollectionPath,
  disabledCampaignManagerMessage,
  parseCampaignList,
  type ClientCampaignManagerModel,
} from "./client-campaign-manager";
import { clientCampaignManagerBlock } from "./client-campaign-manager-env";
import { normalizeTeamWorkspaceClientId } from "./contract";

export async function loadClientCampaignManager(clientAccountId: string): Promise<ClientCampaignManagerModel> {
  await requireStaffWorkspacePermission("team_workspace");
  const client = normalizeTeamWorkspaceClientId(clientAccountId);
  if (!client) return { availability: "error", message: "That client id is not valid. No campaigns were loaded." };
  if (clientCampaignManagerBlock()) return { availability: "disabled", message: disabledCampaignManagerMessage() };
  const result = await adminFetchJson<unknown>(campaignCollectionPath(client));
  if (!result.ok) {
    const code = readErrorCode(result.body);
    if (code === "client_campaign_registry_disabled" || code === "feature_disabled") {
      return { availability: "disabled", message: disabledCampaignManagerMessage() };
    }
    return { availability: "error", message: "Saved campaigns could not be loaded. Nothing was changed." };
  }
  const campaigns = parseCampaignList(result.data, client);
  if (!campaigns) return { availability: "error", message: "The campaign list could not be read. Nothing was changed." };
  return { availability: "ready", campaigns };
}

function readErrorCode(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : null;
  } catch {
    return null;
  }
}
