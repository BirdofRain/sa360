import "server-only";

import { fetchOnboardingSummary } from "@/lib/admin-api/client-onboarding-v2";
import { adminFetchJson, fetchAdminClientDetail, fetchAdminClients, isAdminApiConfigured } from "@/lib/admin-api/server";
import { requireAdminCocAdminSession } from "@/lib/admin-coc-session-guard";

import { isTeamWorkspaceEnabled } from "./config";
import { normalizeTeamWorkspaceClientId } from "./contract";
import { assembleTeamWorkspaceDetail, projectClientOptions, projectRoutingRules } from "./present";
import { parseTeamWorkspaceResponse, readAdminErrorCode } from "./parse";
import type {
  AccountSlice,
  OnboardingSlice,
  TeamWorkspaceDetailModel,
  TeamWorkspaceIndexModel,
  WorkspaceAvailability,
} from "./types";

const CLIENT_LIST_ERROR = "The client list could not be loaded.";

export async function loadTeamWorkspaceIndex(): Promise<TeamWorkspaceIndexModel> {
  await requireAdminCocAdminSession();
  if (!isTeamWorkspaceEnabled()) return { kind: "disabled" };
  if (!isAdminApiConfigured()) {
    return { kind: "error", message: "The admin API is not configured for this app." };
  }
  const result = await fetchAdminClients();
  if (!result.data) return { kind: "error", message: CLIENT_LIST_ERROR };
  return { kind: "ready", clients: projectClientOptions(result.data.items) };
}

export async function loadTeamWorkspaceClient(rawId: string): Promise<TeamWorkspaceDetailModel> {
  await requireAdminCocAdminSession();
  if (!isTeamWorkspaceEnabled()) return { kind: "disabled" };
  const clientAccountId = normalizeTeamWorkspaceClientId(rawId);
  if (!clientAccountId) return { kind: "invalid_client" };
  if (!isAdminApiConfigured()) {
    return { kind: "error", message: "The admin API is not configured for this app." };
  }

  const [workspaceResult, detail, onboarding, list] = await Promise.all([
    adminFetchJson<unknown>(`/admin/v1/team-workspace/clients/${encodeURIComponent(clientAccountId)}`),
    fetchAdminClientDetail(clientAccountId),
    fetchOnboardingSummary(clientAccountId),
    fetchAdminClients(),
  ]);

  return assembleTeamWorkspaceDetail({
    clientAccountId,
    clients: list.data ? projectClientOptions(list.data.items) : [],
    workspace: narrowWorkspace(clientAccountId, workspaceResult),
    account: narrowAccount(detail.data?.item),
    onboarding: narrowOnboarding(onboarding),
  });
}

function narrowWorkspace(
  clientAccountId: string,
  result: Awaited<ReturnType<typeof adminFetchJson<unknown>>>
): WorkspaceAvailability {
  if (!result.ok) {
    const code = readAdminErrorCode(result.status, result.body);
    if (code === "team_workspace_disabled") return { availability: "disabled" };
    if (code === "client_not_found" || code === "not_found") return { availability: "not_found" };
    if (code === "forbidden") return { availability: "forbidden" };
    return { availability: "error", code };
  }
  const body = parseTeamWorkspaceResponse(result.data);
  if (!body || body.client.clientAccountId !== clientAccountId) {
    return { availability: "error", code: "malformed_response" };
  }
  return { availability: "ready", body };
}

function narrowAccount(item: {
  clientDisplayName?: string;
  status?: string;
  routingRules?: {
    campaignName?: string | null;
    utmCampaign?: string | null;
    matchType?: string | null;
    active?: boolean;
  }[];
} | null | undefined): AccountSlice {
  if (!item || typeof item.clientDisplayName !== "string" || typeof item.status !== "string") {
    return { loaded: false };
  }
  return {
    loaded: true,
    clientDisplayName: item.clientDisplayName,
    status: item.status,
    rules: projectRoutingRules(item.routingRules ?? []),
  };
}

function narrowOnboarding(result: Awaited<ReturnType<typeof fetchOnboardingSummary>>): OnboardingSlice {
  if (!result.ok) {
    if (result.error === "onboarding_read_disabled") return { availability: "unavailable" };
    return { availability: "error" };
  }
  const linkedSources = result.data.sources.filter((source) => source.proofs.linked.satisfied === true).length;
  const blockers = result.data.blockers
    .filter((blocker): blocker is string => typeof blocker === "string" && /^[a-z0-9_]{1,80}$/.test(blocker))
    .slice(0, 8);
  return { availability: "ready", linkedSources, blockers };
}
