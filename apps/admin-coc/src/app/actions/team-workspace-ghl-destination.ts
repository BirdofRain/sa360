"use server";

import { requireAdminCocAdminSession, requireAdminCocSession } from "@/lib/admin-coc-session-guard";
import {
  fetchAdminClientDeliveryConfig,
  fetchAdminGhlConnections,
  fetchAdminGhlLocationConfig,
  postAdminGhlConnectionProbe,
} from "@/lib/admin-api/server";
import { isNativeClientSetupEnabled } from "@/lib/clients/native-client-setup-env";
import { isTeamWorkspaceEnabled, isTeamWorkspaceServerEnabled } from "@/lib/team-workspace/config";
import { isSafeTeamWorkspaceId } from "@/lib/team-workspace/contract";
import {
  guidedGhlConfigurationWrite,
  presentGuidedGhlDestination,
  type GuidedGhlDestinationView,
  type GuidedGhlPresentInput,
  type GuidedGhlSnapshot,
} from "@/lib/team-workspace/ghl-destination";

export type GuidedGhlActionResult =
  | { ok: true; view: GuidedGhlDestinationView }
  | { ok: false; code: string; message: string; view: GuidedGhlDestinationView | null };

type LoadedDestination = {
  result: GuidedGhlActionResult;
  present: GuidedGhlPresentInput | null;
};

function disabledMessage(): string | null {
  if (!isTeamWorkspaceEnabled() || !isTeamWorkspaceServerEnabled()) {
    return "Team Workspace is turned off. The GoHighLevel destination was not read, and delivery was not turned on.";
  }
  if (!isNativeClientSetupEnabled()) {
    return "Client setup is turned off. The GoHighLevel destination was not read, and delivery was not turned on.";
  }
  return null;
}

function isUncertain(error: string | null | undefined): boolean {
  if (!error) return true;
  return error.startsWith("Admin API request failed") || error.includes("temporarily unavailable") || error.includes("non-JSON");
}

function readableGhlError(error: string | null | undefined, fallback: string): string {
  if (!error) return fallback;
  if (error.includes("NOT_CONNECTED") || error.includes("No connected GHL")) {
    return "This location has no connected GoHighLevel credentials. Nothing was read from GoHighLevel, and nothing was saved.";
  }
  if (isUncertain(error)) return "The GoHighLevel read could not be confirmed. Nothing was saved.";
  return fallback;
}

async function authorize(): Promise<GuidedGhlActionResult | null> {
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  const message = disabledMessage();
  if (!message) return null;
  return { ok: false, code: "FEATURE_DISABLED", message, view: null };
}

async function loadDestination(clientAccountId: string): Promise<LoadedDestination> {
  const denied = await authorize();
  if (denied) return { result: denied, present: null };
  const id = clientAccountId.trim();
  if (!isSafeTeamWorkspaceId(id)) {
    return {
      result: { ok: false, code: "INVALID_CLIENT", message: "This client id cannot be read.", view: null },
      present: null,
    };
  }
  const [config, connections] = await Promise.all([
    fetchAdminClientDeliveryConfig(id),
    fetchAdminGhlConnections(id),
  ]);
  if (!config.data || config.error) {
    const message = readableGhlError(config.error, "The GoHighLevel destination could not be read.");
    const present: GuidedGhlPresentInput = {
      clientAccountId: id,
      loadError: message,
      uncertain: isUncertain(config.error),
    };
    return {
      result: {
        ok: false,
        code: isUncertain(config.error) ? "UNCERTAIN" : "READ_FAILED",
        message,
        view: presentGuidedGhlDestination(present),
      },
      present,
    };
  }
  const present: GuidedGhlPresentInput = {
    clientAccountId: id,
    destination: config.data.ghlDestination,
    issueCodes: config.data.issueCodes,
    connection: config.data.connection,
    connections: connections.data?.items ?? [],
    extraIssues: connections.error ? ["Connected locations could not be read."] : [],
    uncertain: Boolean(connections.error) && isUncertain(connections.error),
  };
  const view = presentGuidedGhlDestination(present);
  if (connections.error) {
    return {
      result: {
        ok: false,
        code: isUncertain(connections.error) ? "UNCERTAIN" : "READ_FAILED",
        message: connections.error,
        view,
      },
      present,
    };
  }
  return { result: { ok: true, view }, present };
}

export async function loadTeamWorkspaceGhlDestinationAction(clientAccountId: string): Promise<GuidedGhlActionResult> {
  const loaded = await loadDestination(clientAccountId);
  return loaded.result;
}

export async function readTeamWorkspaceGhlSnapshotAction(
  clientAccountId: string,
  locationId: string,
  refresh = false
): Promise<GuidedGhlActionResult> {
  const loaded = await loadDestination(clientAccountId);
  if (!loaded.result.view || loaded.result.view.availability !== "ready" || !loaded.present) return loaded.result;
  const id = locationId.trim();
  const allowed =
    loaded.result.view.locationId === id || loaded.result.view.locations.some((location) => location.locationId === id);
  if (!id || !allowed) {
    return {
      ok: false,
      code: "INVALID_LOCATION",
      message: "That GoHighLevel location is not linked to this client. It was not read.",
      view: loaded.result.view,
    };
  }
  const discovery = await fetchAdminGhlLocationConfig(id, refresh);
  if (!discovery.data || discovery.error) {
    const message = readableGhlError(discovery.error, "The GoHighLevel location could not be read.");
    return {
      ok: false,
      code: isUncertain(discovery.error) ? "UNCERTAIN" : "READ_FAILED",
      message,
      view: presentGuidedGhlDestination({
        ...loaded.present,
        snapshotError: message,
        uncertain: isUncertain(discovery.error),
      }),
    };
  }
  const snapshot: GuidedGhlSnapshot = {
    locationId: id,
    workflows: discovery.data.workflows,
    customFields: discovery.data.customFields,
    fetchedAt: discovery.data.fetchedAt,
    fromCache: discovery.data.fromCache,
    errors: discovery.data.errors,
  };
  return { ok: true, view: presentGuidedGhlDestination({ ...loaded.present, snapshot }) };
}

export async function checkTeamWorkspaceGhlConnectionAction(
  clientAccountId: string,
  connectionId: string
): Promise<GuidedGhlActionResult> {
  const loaded = await loadDestination(clientAccountId);
  if (!loaded.result.view || loaded.result.view.availability !== "ready") return loaded.result;
  if (loaded.result.view.live) {
    return {
      ok: false,
      code: "LIVE_DESTINATION",
      message: "This destination is already live. The credential check was not sent.",
      view: loaded.result.view,
    };
  }
  const id = connectionId.trim();
  const known = loaded.result.view.locations.some((location) => location.connectionId === id);
  if (!id || !known) {
    return {
      ok: false,
      code: "INVALID_LOCATION",
      message: "That connection is not linked to this client. It was not checked.",
      view: loaded.result.view,
    };
  }
  const probe = await postAdminGhlConnectionProbe(id);
  if (!probe.data || probe.error) {
    const message = readableGhlError(probe.error, "The GoHighLevel credential check could not be completed.");
    return {
      ok: false,
      code: isUncertain(probe.error) ? "UNCERTAIN" : "READ_FAILED",
      message,
      view: loaded.result.view,
    };
  }
  const refreshed = await loadDestination(clientAccountId);
  return refreshed.result;
}

export async function saveTeamWorkspaceGhlDestinationAction(clientAccountId: string): Promise<GuidedGhlActionResult> {
  const denied = await authorize();
  if (denied) return denied;
  if (!isSafeTeamWorkspaceId(clientAccountId.trim())) {
    return { ok: false, code: "INVALID_CLIENT", message: "This client id cannot be saved.", view: null };
  }
  const blocked = guidedGhlConfigurationWrite();
  return { ok: false, code: "WRITE_BLOCKED", message: blocked.reason, view: null };
}
