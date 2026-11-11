"use server";

import { requireAdminCocAdminSession, requireAdminCocSession, requireStaffWorkspacePermission } from "@/lib/admin-coc-session-guard";
import {
  fetchAdminClientDeliveryConfig,
  fetchAdminGhlConnections,
  fetchAdminGhlDestinationConfiguration,
  fetchAdminGhlLocationConfig,
  postAdminGhlConnectionProbe,
  postAdminGhlDestinationConfiguration,
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
import { isGhlDestinationConfigRequestEnabled } from "@/lib/team-workspace/ghl-destination-config-request-env";
import {
  ghlConfigRequestErrorMessage,
  parseGhlConfigHead,
  parseGhlConfigSaveResult,
  presentGhlLocationPreview,
  readGhlConfigError,
  type GhlConfigHead,
  type GhlConfigSubmitBody,
  type GhlLocationPreview,
} from "@/lib/team-workspace/ghl-destination-config-request";

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

export type GhlConfigLoadResult = {
  ok: boolean;
  uncertain: boolean;
  code: string | null;
  message: string | null;
  head: GhlConfigHead | null;
};

export type GhlLocationPreviewResult = {
  ok: boolean;
  uncertain: boolean;
  code: string | null;
  message: string | null;
  preview: GhlLocationPreview | null;
};

export type GhlConfigSaveResult = {
  ok: boolean;
  uncertain: boolean;
  stored: boolean;
  retainRequestId: boolean;
  needsReload: boolean;
  code: string | null;
  message: string;
  revision: number | null;
  requestId: string | null;
  replayed: boolean;
  sent: GhlConfigSubmitBody | null;
};

const RELOAD_CODES = new Set(["revision_conflict", "destination_stale", "request_id_reused"]);

function configDisabledMessage(): string | null {
  const workspace = disabledMessage();
  if (workspace) return workspace;
  if (!isGhlDestinationConfigRequestEnabled()) return ghlConfigRequestErrorMessage("FEATURE_DISABLED");
  return null;
}

async function authorizeConfig(): Promise<GhlConfigLoadResult | null> {
  const message = configDisabledMessage();
  if (!message) return null;
  return { ok: false, uncertain: false, code: "FEATURE_DISABLED", message, head: null };
}

function parseBody(body: string): unknown {
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

function normalizeSubmit(input: GhlConfigSubmitBody): GhlConfigSubmitBody | null {
  if (!input || typeof input.requestId !== "string" || typeof input.locationId !== "string" || typeof input.workflowId !== "string") {
    return null;
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) return null;
  if (input.expectedDestinationUpdatedAt !== null && typeof input.expectedDestinationUpdatedAt !== "string") return null;
  if (!Array.isArray(input.fieldMappings)) return null;
  const fieldMappings = input.fieldMappings.map((row) => ({
    key: typeof row?.key === "string" ? row.key.trim() : "",
    fieldId: typeof row?.fieldId === "string" ? row.fieldId.trim() : "",
  }));
  if (fieldMappings.some((row) => !row.key || !row.fieldId)) return null;
  return {
    requestId: input.requestId.trim(),
    expectedRevision: input.expectedRevision,
    expectedDestinationUpdatedAt: input.expectedDestinationUpdatedAt,
    locationId: input.locationId.trim(),
    workflowId: input.workflowId.trim(),
    fieldMappings: [...fieldMappings].sort((left, right) => left.key.localeCompare(right.key)),
  };
}

function closedSave(code: string, message: string, sent: GhlConfigSubmitBody | null = null): GhlConfigSaveResult {
  return {
    ok: false,
    uncertain: false,
    stored: false,
    retainRequestId: false,
    needsReload: false,
    code,
    message,
    revision: null,
    requestId: sent?.requestId ?? null,
    replayed: false,
    sent,
  };
}

function uncertainSave(message: string, sent: GhlConfigSubmitBody): GhlConfigSaveResult {
  return {
    ok: false,
    uncertain: true,
    stored: false,
    retainRequestId: true,
    needsReload: false,
    code: "UNCERTAIN",
    message,
    revision: null,
    requestId: sent.requestId,
    replayed: false,
    sent,
  };
}

export async function loadTeamWorkspaceGhlConfigurationAction(clientAccountId: string): Promise<GhlConfigLoadResult> {
  await requireStaffWorkspacePermission("team_workspace");
  const denied = await authorizeConfig();
  if (denied) return denied;
  const id = clientAccountId.trim();
  if (!isSafeTeamWorkspaceId(id)) {
    return { ok: false, uncertain: false, code: "INVALID_CLIENT", message: "This client id cannot be read.", head: null };
  }
  const response = await fetchAdminGhlDestinationConfiguration(id);
  if (!response.ok) {
    const code = readGhlConfigError(parseBody(response.body));
    if (code) return { ok: false, uncertain: false, code, message: ghlConfigRequestErrorMessage(code), head: null };
    return {
      ok: false,
      uncertain: true,
      code: "UNCERTAIN",
      message: "The configuration request could not be read. Retry the read. Nothing was stored.",
      head: null,
    };
  }
  const head = parseGhlConfigHead(response.data);
  if (!head || head.clientAccountId !== id) {
    return {
      ok: false,
      uncertain: false,
      code: "UNREADABLE",
      message: "The configuration response could not be read. Reload before submitting. Nothing was stored.",
      head: null,
    };
  }
  return { ok: true, uncertain: false, code: null, message: null, head };
}

export async function previewTeamWorkspaceGhlLocationAction(
  clientAccountId: string,
  locationId: string,
  refresh = false
): Promise<GhlLocationPreviewResult> {
  await requireAdminCocSession();
  await requireAdminCocAdminSession();
  const flagged = configDisabledMessage();
  if (flagged) {
    return { ok: false, uncertain: false, code: "FEATURE_DISABLED", message: flagged, preview: null };
  }
  const loaded = await loadDestination(clientAccountId);
  const view = loaded.result.view;
  if (!view || view.availability !== "ready") {
    return {
      ok: false,
      uncertain: loaded.result.ok ? false : loaded.result.code === "UNCERTAIN",
      code: loaded.result.ok ? "READ_FAILED" : loaded.result.code,
      message: loaded.result.ok ? "The linked locations could not be read." : loaded.result.message,
      preview: null,
    };
  }
  const id = locationId.trim();
  const location = view.locations.find((item) => item.locationId === id);
  if (!id || !location || location.connectionStatus !== "connected") {
    const detail = location?.lastError ? ` ${location.lastError}` : "";
    return {
      ok: false,
      uncertain: false,
      code: "location_not_linked",
      message: `${ghlConfigRequestErrorMessage("location_not_linked")}${detail}`,
      preview: null,
    };
  }
  const discovery = await fetchAdminGhlLocationConfig(id, refresh);
  if (!discovery.data || discovery.error) {
    const message = readableGhlError(discovery.error, "The GoHighLevel location snapshot could not be read.");
    return {
      ok: false,
      uncertain: isUncertain(discovery.error),
      code: isUncertain(discovery.error) ? "UNCERTAIN" : "READ_FAILED",
      message,
      preview: null,
    };
  }
  const reported = discovery.data.location && typeof discovery.data.location === "object" ? discovery.data.location.id : null;
  const preview = presentGhlLocationPreview({
    locationId: id,
    reportedLocationId: reported,
    workflows: discovery.data.workflows,
    customFields: discovery.data.customFields,
    fetchedAt: discovery.data.fetchedAt,
    fromCache: discovery.data.fromCache,
    errors: discovery.data.errors,
  });
  if (!preview || preview.locationId !== id) {
    return {
      ok: false,
      uncertain: false,
      code: "SNAPSHOT_LOCATION",
      message: "The snapshot belonged to a different location and was not used.",
      preview: null,
    };
  }
  return { ok: true, uncertain: false, code: null, message: null, preview };
}

export async function saveTeamWorkspaceGhlConfigurationRequestAction(
  input: GhlConfigSubmitBody & { clientAccountId: string }
): Promise<GhlConfigSaveResult> {
  await requireStaffWorkspacePermission("team_manager");
  const denied = await authorizeConfig();
  if (denied) return closedSave("FEATURE_DISABLED", denied.message ?? ghlConfigRequestErrorMessage("FEATURE_DISABLED"));
  const clientAccountId = input.clientAccountId.trim();
  if (!isSafeTeamWorkspaceId(clientAccountId)) {
    return closedSave("INVALID_CLIENT", "This client id cannot be saved.");
  }
  const sent = normalizeSubmit(input);
  if (!sent) return closedSave("invalid_body", ghlConfigRequestErrorMessage("invalid_body"));
  const response = await postAdminGhlDestinationConfiguration(clientAccountId, { ...sent });
  if (!response.ok) {
    const code = readGhlConfigError(parseBody(response.body));
    if (!code || transportFailed(response.status, response.body)) {
      return uncertainSave(
        "The configuration request did not finish. Retry uses the same request id and the same payload. Nothing on this page was marked stored.",
        sent
      );
    }
    return {
      ok: false,
      uncertain: false,
      stored: false,
      retainRequestId: code === "destination_busy",
      needsReload: RELOAD_CODES.has(code),
      code,
      message: ghlConfigRequestErrorMessage(code),
      revision: null,
      requestId: sent.requestId,
      replayed: false,
      sent,
    };
  }
  const saved = parseGhlConfigSaveResult(response.data);
  if (!saved) {
    return closedSave(
      "UNREADABLE",
      "The response could not be read as a configuration request. Reload before submitting again.",
      sent
    );
  }
  return {
    ok: true,
    uncertain: false,
    stored: true,
    retainRequestId: false,
    needsReload: false,
    code: null,
    message: saved.replayed
      ? "This configuration request was already stored. The operational destination was not changed."
      : "The configuration request was stored. The operational destination was not changed.",
    revision: saved.revision,
    requestId: saved.requestId,
    replayed: saved.replayed,
    sent,
  };
}
