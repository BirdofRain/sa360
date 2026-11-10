/**
 * Read-only presentation of a client's saved GoHighLevel destination.
 * A display name is never a field id. This module does not write.
 */

import {
  fieldSuggestions,
  savedMappingEntries,
  type DiscoveredDestinationField,
} from "@/lib/clients/onboarding/ghl-vet-setup-display";

export const GUIDED_GHL_SURVEY_KEYS = ["desired_coverage", "branch_of_service", "primary_reason"] as const;

export const GUIDED_GHL_SURVEY_LABELS: Record<(typeof GUIDED_GHL_SURVEY_KEYS)[number], string> = {
  desired_coverage: "Desired coverage",
  branch_of_service: "Branch of service",
  primary_reason: "Primary reason",
};

export const GUIDED_GHL_WRITE_BLOCK =
  "Saving a GoHighLevel location, workflow, or field id from Team Workspace is blocked. The existing destination save rewrites field ids from discovered names and can change a destination that is already live. This page does not turn delivery on, enroll a lead, or change Company Sheets.";

const ISSUE_TEXT: Record<string, string> = {
  client_not_found: "The client record was not found.",
  location_unlinked: "No GoHighLevel location is saved for this client.",
  oauth_revoked: "The GoHighLevel credentials are revoked.",
  probe_required: "The location credentials have not been checked.",
  location_mismatch: "The location on the destination does not match the connected location.",
};

export type GuidedGhlFieldStatus = "missing" | "unverified" | "verified" | "unresolved" | "name_only" | "duplicate";

export type GuidedGhlFieldRow = {
  key: string;
  label: string;
  savedId: string | null;
  status: GuidedGhlFieldStatus;
  detail: string;
};

export type GuidedGhlLocationChoice = {
  connectionId: string;
  locationId: string;
  locationName: string | null;
  connectionStatus: string;
  lastError: string | null;
  saved: boolean;
};

export type GuidedGhlWorkflowChoice = {
  id: string;
  name: string;
  saved: boolean;
};

export type GuidedGhlDestinationView = {
  availability: "ready" | "disabled" | "forbidden" | "error";
  message: string | null;
  uncertain: boolean;
  clientAccountId: string;
  configured: boolean;
  verified: boolean;
  active: boolean;
  live: boolean;
  locationId: string | null;
  locationName: string | null;
  connectionStatus: string | null;
  connectionId: string | null;
  workflowId: string | null;
  workflowName: string | null;
  workflowInSnapshot: boolean | null;
  workflowTriggerMode: string | null;
  deliveryMode: string | null;
  deliveryEnabled: boolean | null;
  clientCutoverApproved: boolean | null;
  internalApprovalStatus: string | null;
  updatedAt: string | null;
  issues: string[];
  fields: GuidedGhlFieldRow[];
  stampFields: GuidedGhlFieldRow[];
  locations: GuidedGhlLocationChoice[];
  workflows: GuidedGhlWorkflowChoice[];
  snapshotLoaded: boolean;
  snapshotLocationId: string | null;
  snapshotFetchedAt: string | null;
  snapshotFromCache: boolean | null;
  webformNote: string | null;
  writesBlocked: string;
};

export type GuidedGhlSnapshot = {
  locationId: string;
  workflows: Array<{ id?: unknown; name?: unknown }>;
  customFields: Array<{ id?: unknown; name?: unknown; key?: unknown; fieldKey?: unknown }>;
  fetchedAt?: unknown;
  fromCache?: unknown;
  errors?: unknown;
};

export type GuidedGhlPresentInput = {
  clientAccountId: string;
  disabledMessage?: string | null;
  forbidden?: boolean;
  loadError?: string | null;
  uncertain?: boolean;
  destination?: unknown;
  issueCodes?: unknown;
  connections?: unknown;
  connection?: unknown;
  snapshot?: GuidedGhlSnapshot | null;
  snapshotError?: string | null;
  extraIssues?: string[];
};

type DestinationShape = {
  locationId: string | null;
  locationName: string | null;
  connectionStatus: string | null;
  workflowId: string | null;
  workflowTriggerMode: string | null;
  deliveryMode: string | null;
  deliveryEnabled: boolean;
  clientCutoverApproved: boolean;
  internalApprovalStatus: string | null;
  updatedAt: string | null;
  sourceMap: unknown;
  stampMap: Record<string, string>;
};

export function isGuidedLiveDestination(destination: {
  locationId: string | null;
  deliveryEnabled: boolean;
  deliveryMode: string | null;
  clientCutoverApproved: boolean;
  internalApprovalStatus: string | null;
}): boolean {
  const location = destination.locationId?.trim() ?? "";
  if (!location) return false;
  return (
    destination.deliveryEnabled === true &&
    destination.deliveryMode === "live" &&
    destination.clientCutoverApproved === true &&
    destination.internalApprovalStatus === "approved"
  );
}

export function ghlDestinationChanged(previous: string | null, next: string | null): boolean {
  return Boolean(previous && next && previous !== next);
}

export function guidedGhlConfigurationWrite(): { allowed: false; reason: string } {
  return { allowed: false, reason: GUIDED_GHL_WRITE_BLOCK };
}

export function presentGuidedGhlDestination(input: GuidedGhlPresentInput): GuidedGhlDestinationView {
  const base = emptyView(input.clientAccountId);
  if (input.disabledMessage) {
    return { ...base, availability: "disabled", message: input.disabledMessage, writesBlocked: GUIDED_GHL_WRITE_BLOCK };
  }
  if (input.forbidden) {
    return {
      ...base,
      availability: "forbidden",
      message: "You do not have permission to read this GoHighLevel destination.",
    };
  }
  if (input.loadError) {
    return {
      ...base,
      availability: "error",
      uncertain: input.uncertain === true,
      message: input.loadError,
    };
  }

  const destination = readDestination(input.destination);
  const locations = readLocations(input.connections, input.connection, destination?.locationId ?? null);
  const savedLocation = locations.find((location) => location.saved) ?? null;
  const snapshot = readSnapshot(input.snapshot);
  const snapshotForSaved = Boolean(snapshot && destination?.locationId && snapshot.locationId === destination.locationId);
  const fieldsForReview = snapshotForSaved ? snapshot?.fields ?? [] : [];
  const discoveryLoaded = snapshotForSaved;
  const sourceIds = savedIds(destination?.sourceMap);
  const duplicateIds = duplicateSavedIds({ ...sourceIds, ...(destination?.stampMap ?? {}) });
  const fields = GUIDED_GHL_SURVEY_KEYS.map((key) =>
    reviewField({
      key,
      label: GUIDED_GHL_SURVEY_LABELS[key],
      savedId: sourceIds[key] ?? null,
      fields: fieldsForReview,
      discoveryLoaded,
      duplicate: Boolean(sourceIds[key] && duplicateIds.has(sourceIds[key])),
    })
  );
  const stampFields = Object.entries(destination?.stampMap ?? {}).map(([key, savedId]) =>
    reviewField({
      key,
      label: key,
      savedId,
      fields: fieldsForReview,
      discoveryLoaded,
      duplicate: duplicateIds.has(savedId),
    })
  );
  const workflowId = destination?.workflowId ?? null;
  const workflowName =
    snapshotForSaved && workflowId ? snapshot?.workflows.find((workflow) => workflow.id === workflowId)?.name ?? null : null;
  const workflowInSnapshot =
    !destination?.locationId || !workflowId
      ? null
      : snapshotForSaved
        ? Boolean(workflowName) || Boolean(snapshot?.workflows.some((workflow) => workflow.id === workflowId))
        : null;
  const live = destination ? isGuidedLiveDestination(destination) : false;
  const configured = Boolean(destination?.locationId);
  const issues = collectIssues({
    extraIssues: input.extraIssues ?? [],
    destination,
    locations,
    savedLocation,
    issueCodes: readCodes(input.issueCodes),
    fields,
    stampFields,
    workflowId,
    workflowInSnapshot,
    snapshotForSaved,
    snapshotError: input.snapshotError ?? null,
    snapshotErrors: snapshot?.errors ?? [],
    live,
    differentSnapshot: Boolean(snapshot && destination?.locationId && snapshot.locationId !== destination.locationId),
  });
  const verified =
    configured &&
    savedLocation?.connectionStatus === "connected" &&
    workflowInSnapshot === true &&
    fields.every((field) => field.status === "verified") &&
    stampFields.length > 0 &&
    stampFields.every((field) => field.status === "verified") &&
    !issues.some((issue) => /revoked|not been checked|does not match the connected location|credentials/i.test(issue));

  return {
    ...base,
    availability: "ready",
    uncertain: input.uncertain === true,
    message: input.snapshotError ?? null,
    configured,
    verified,
    active: live,
    live,
    locationId: destination?.locationId ?? null,
    locationName: destination?.locationName ?? savedLocation?.locationName ?? null,
    connectionStatus: savedLocation?.connectionStatus ?? destination?.connectionStatus ?? null,
    connectionId: savedLocation?.connectionId ?? null,
    workflowId,
    workflowName,
    workflowInSnapshot,
    workflowTriggerMode: destination?.workflowTriggerMode ?? null,
    deliveryMode: destination?.deliveryMode ?? null,
    deliveryEnabled: destination ? destination.deliveryEnabled : null,
    clientCutoverApproved: destination ? destination.clientCutoverApproved : null,
    internalApprovalStatus: destination?.internalApprovalStatus ?? null,
    updatedAt: destination?.updatedAt ?? null,
    issues,
    fields,
    stampFields,
    locations,
    workflows: (snapshotForSaved ? snapshot?.workflows ?? [] : []).map((workflow) => ({
      ...workflow,
      saved: workflow.id === workflowId,
    })),
    snapshotLoaded: discoveryLoaded,
    snapshotLocationId: snapshot?.locationId ?? null,
    snapshotFetchedAt: snapshot?.fetchedAt ?? null,
    snapshotFromCache: snapshot?.fromCache ?? null,
    webformNote: webformNote(snapshotForSaved ? snapshot?.workflows ?? [] : []),
  };
}

function emptyView(clientAccountId: string): GuidedGhlDestinationView {
  return {
    availability: "ready",
    message: null,
    uncertain: false,
    clientAccountId,
    configured: false,
    verified: false,
    active: false,
    live: false,
    locationId: null,
    locationName: null,
    connectionStatus: null,
    connectionId: null,
    workflowId: null,
    workflowName: null,
    workflowInSnapshot: null,
    workflowTriggerMode: null,
    deliveryMode: null,
    deliveryEnabled: null,
    clientCutoverApproved: null,
    internalApprovalStatus: null,
    updatedAt: null,
    issues: [],
    fields: [],
    stampFields: [],
    locations: [],
    workflows: [],
    snapshotLoaded: false,
    snapshotLocationId: null,
    snapshotFetchedAt: null,
    snapshotFromCache: null,
    webformNote: null,
    writesBlocked: GUIDED_GHL_WRITE_BLOCK,
  };
}

function reviewField(input: {
  key: string;
  label: string;
  savedId: string | null;
  fields: DiscoveredDestinationField[];
  discoveryLoaded: boolean;
  duplicate: boolean;
}): GuidedGhlFieldRow {
  const savedId = input.savedId?.trim() || null;
  if (input.duplicate && savedId) {
    return {
      key: input.key,
      label: input.label,
      savedId,
      status: "duplicate",
      detail: "This saved field id is used by more than one mapping.",
    };
  }
  if (!savedId) {
    const suggestion = input.discoveryLoaded ? fieldSuggestions({ key: input.key, fields: input.fields }) : null;
    if (suggestion && suggestion.fields.length > 0) {
      const names = suggestion.fields.map((field) => field.name).join(", ");
      return {
        key: input.key,
        label: input.label,
        savedId: null,
        status: "name_only",
        detail: `${names} matches the display name. That match is not a saved field id.`,
      };
    }
    return {
      key: input.key,
      label: input.label,
      savedId: null,
      status: "missing",
      detail: "No field id is saved.",
    };
  }
  if (!input.discoveryLoaded) {
    return {
      key: input.key,
      label: input.label,
      savedId,
      status: "unverified",
      detail: "This saved id has not been compared with a location snapshot.",
    };
  }
  const byId = input.fields.find((field) => field.id === savedId);
  if (byId) {
    return {
      key: input.key,
      label: input.label,
      savedId,
      status: "verified",
      detail: `Saved field id matches ${byId.name}.`,
    };
  }
  const byKey = input.fields.find((field) => field.fieldKey === savedId || field.key === savedId);
  const suggestion = fieldSuggestions({ key: input.key, fields: input.fields });
  const nameNote =
    suggestion.fields.length > 0
      ? ` A display name match (${suggestion.fields.map((field) => field.name).join(", ")}) is not a saved field id.`
      : "";
  if (byKey) {
    return {
      key: input.key,
      label: input.label,
      savedId,
      status: "unresolved",
      detail: `The saved value matches a field key, not the field id.${nameNote}`,
    };
  }
  return {
    key: input.key,
    label: input.label,
    savedId,
    status: "unresolved",
    detail: `The saved value is not a field id in the location snapshot.${nameNote}`,
  };
}

function collectIssues(input: {
  extraIssues: string[];
  destination: DestinationShape | null;
  locations: GuidedGhlLocationChoice[];
  savedLocation: GuidedGhlLocationChoice | null;
  issueCodes: string[];
  fields: GuidedGhlFieldRow[];
  stampFields: GuidedGhlFieldRow[];
  workflowId: string | null;
  workflowInSnapshot: boolean | null;
  snapshotForSaved: boolean;
  snapshotError: string | null;
  snapshotErrors: string[];
  live: boolean;
  differentSnapshot: boolean;
}): string[] {
  const issues: string[] = [...input.extraIssues];
  if (!input.destination?.locationId) issues.push("No GoHighLevel location is saved yet.");
  if (input.destination?.locationId && !input.savedLocation) {
    issues.push("A location id is saved, but no credentials are linked to it.");
  } else if (input.locations.length === 0) {
    issues.push("No GoHighLevel credentials are linked to this client.");
  }
  for (const code of input.issueCodes) {
    const text = ISSUE_TEXT[code] ?? `The destination read reported ${code}.`;
    if (!issues.includes(text)) issues.push(text);
  }
  if (input.savedLocation && input.savedLocation.connectionStatus !== "connected") {
    const status = input.savedLocation.connectionStatus || "unknown";
    issues.push(
      status === "revoked"
        ? "The linked GoHighLevel credentials are revoked."
        : `The linked location is ${status}. A failed or missing credential check is not a verified location.`
    );
  }
  if (!input.workflowId) issues.push("No workflow id is saved. A workflow name was not selected in its place.");
  if (input.workflowInSnapshot === false) issues.push("The saved workflow id is not in the location snapshot.");
  if (input.differentSnapshot) {
    issues.push("The loaded snapshot is for a different location, so it does not verify the saved destination.");
  }
  if (input.snapshotError) issues.push(input.snapshotError);
  for (const error of input.snapshotErrors) issues.push(error);
  for (const field of [...input.fields, ...input.stampFields]) {
    if (field.status !== "verified") issues.push(`${field.label}: ${field.detail}`);
  }
  if (input.stampFields.length === 0) {
    issues.push("No SA360 field ids are saved. Display names were not used to fill them in.");
  }
  if (input.live) issues.push("This destination is already live. This page will not change it.");
  if (!input.snapshotForSaved && input.destination?.locationId) {
    issues.push("Location details have not been read, so saved field ids are not verified.");
  }
  return issues;
}

function webformNote(workflows: Array<{ id: string; name: string }>): string | null {
  if (workflows.length === 0) return null;
  const named = workflows.filter((workflow) => /webform/i.test(workflow.name));
  if (named.length === 1) {
    return "One workflow name includes Webform. It is used only when its id is the saved workflow id.";
  }
  return "Webform workflows are not selected by name. A saved workflow id counts only when that id is in this list.";
}

function savedIds(raw: unknown): Record<string, string> {
  const entries = savedMappingEntries(raw);
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(entries)) out[key] = entry.ghlFieldKey;
  return out;
}

function duplicateSavedIds(ids: Record<string, string>): Set<string> {
  const counts = new Map<string, number>();
  for (const value of Object.values(ids)) {
    const token = value.trim();
    if (!token) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([token]) => token));
}

function readDestination(value: unknown): DestinationShape | null {
  const record = asRecord(value);
  if (!record) return null;
  const locationId = text(record.destinationSubaccountIdGhl);
  if (!locationId && !text(record.destinationWorkflowIdGhl) && !record.sourceAttributeFieldMapJson) return null;
  return {
    locationId,
    locationName: text(record.locationName),
    connectionStatus: text(record.ghlConnectionStatus),
    workflowId: text(record.destinationWorkflowIdGhl),
    workflowTriggerMode: text(record.workflowTriggerMode),
    deliveryMode: text(record.deliveryMode),
    deliveryEnabled: record.deliveryEnabled === true,
    clientCutoverApproved: record.clientCutoverApproved === true,
    internalApprovalStatus: text(record.internalApprovalStatus),
    updatedAt: text(record.updatedAt),
    sourceMap: record.sourceAttributeFieldMapJson,
    stampMap: stringMap(record.sa360CustomFieldIdMapJson),
  };
}

function readLocations(connections: unknown, connection: unknown, savedLocationId: string | null): GuidedGhlLocationChoice[] {
  const rows = Array.isArray(connections) ? connections : [];
  const items = rows.map(readLocation).filter((item): item is GuidedGhlLocationChoice => item !== null);
  const single = readLocation(connection);
  if (single && !items.some((item) => item.connectionId === single.connectionId || item.locationId === single.locationId)) {
    items.push(single);
  }
  return items.map((item) => ({ ...item, saved: Boolean(savedLocationId && item.locationId === savedLocationId) }));
}

function readLocation(value: unknown): GuidedGhlLocationChoice | null {
  const record = asRecord(value);
  if (!record) return null;
  const locationId = text(record.locationId);
  const connectionId = text(record.id) ?? locationId;
  if (!locationId || !connectionId) return null;
  return {
    connectionId,
    locationId,
    locationName: text(record.locationName),
    connectionStatus: text(record.connectionStatus) ?? "unknown",
    lastError: text(record.lastError),
    saved: false,
  };
}

function readSnapshot(snapshot: GuidedGhlSnapshot | null | undefined): {
  locationId: string;
  workflows: Array<{ id: string; name: string }>;
  fields: DiscoveredDestinationField[];
  fetchedAt: string | null;
  fromCache: boolean;
  errors: string[];
} | null {
  if (!snapshot) return null;
  const locationId = snapshot.locationId.trim();
  if (!locationId) return null;
  const workflows = snapshot.workflows.flatMap((workflow) => {
    const id = text(workflow.id);
    if (!id) return [];
    return [{ id, name: text(workflow.name) ?? id }];
  });
  const fields = snapshot.customFields.flatMap((field) => {
    const id = text(field.id);
    const name = text(field.name);
    if (!id || !name) return [];
    return [{ id, name, key: text(field.key), fieldKey: text(field.fieldKey) }];
  });
  const errors = Array.isArray(snapshot.errors)
    ? snapshot.errors.flatMap((error) => {
        const message = text(error);
        return message ? [message] : [];
      })
    : [];
  return {
    locationId,
    workflows,
    fields,
    fetchedAt: text(snapshot.fetchedAt),
    fromCache: snapshot.fromCache === true,
    errors,
  };
}

function readCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((code) => {
    const textValue = text(code);
    return textValue ? [textValue] : [];
  });
}

function stringMap(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    const saved = text(entry);
    const name = key.trim();
    if (name && saved) out[name] = saved;
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
