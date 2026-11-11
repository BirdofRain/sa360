/**
 * Intended GoHighLevel configuration requests.
 * A stored request is not an operational destination. Field names and field
 * keys are never copied into a field id.
 */

import { fieldSuggestions, type DiscoveredDestinationField } from "@/lib/clients/onboarding/ghl-vet-setup-display";
import { GUIDED_GHL_SURVEY_KEYS, GUIDED_GHL_SURVEY_LABELS } from "@/lib/team-workspace/ghl-destination";

/** Keep aligned with apps/api/src/lib/sa360-custom-field-keys.ts */
export const GHL_CONFIG_LOGICAL_FIELD_KEYS = [
  "sa360_lead_uid",
  "sa360_client_account_id",
  "sa360_lifecycle_stage",
  "sa360_routing_status",
  "sa360_backend_sync_status",
  "sa360_delivery_plan_id",
  "sa360_delivery_run_id",
  "sa360_event_uuid",
  "sa360_utm_campaign",
  "sa360_campaign_id",
  "sa360_source_platform",
  "sa360_niche_key",
  "sa360_niche_label",
  "sa360_source_type",
  "sa360_campaign_name",
  "sa360_adset_id",
  "sa360_ad_id",
  "sa360_utm_content",
  "sa360_delivery_idempotency_key",
  "sa360_delivery_mode",
] as const;

export const GHL_CONFIG_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const GHL_CONFIG_SNAPSHOT_FUTURE_SKEW_MS = 5 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERROR_CODE = /^[a-z0-9_]{1,80}$/;

const FIELD_KEYS = new Set<string>([...GUIDED_GHL_SURVEY_KEYS, ...GHL_CONFIG_LOGICAL_FIELD_KEYS]);

export type GhlConfigFieldMapping = {
  key: string;
  fieldId: string;
};

export type GhlConfigStoredRequest = {
  requestId: string;
  revision: number;
  locationId: string;
  workflowId: string;
  fieldMappings: GhlConfigFieldMapping[];
  snapshotFetchedAt: string;
  createdAt: string;
};

export type GhlConfigHead = {
  clientAccountId: string;
  revision: number;
  destinationUpdatedAt: string | null;
  liveDestination: boolean;
  configuration: GhlConfigStoredRequest | null;
};

export type GhlConfigSubmitBody = {
  requestId: string;
  expectedRevision: number;
  expectedDestinationUpdatedAt: string | null;
  locationId: string;
  workflowId: string;
  fieldMappings: GhlConfigFieldMapping[];
};

export type GhlConfigDraft = {
  locationId: string;
  workflowId: string;
  mappings: Record<string, string>;
};

export type GhlLocationPreview = {
  locationId: string;
  fetchedAt: string | null;
  fromCache: boolean;
  snapshotVerification?: "live" | "cached" | "previously_captured" | null;
  workflows: Array<{ id: string; name: string }>;
  fields: Array<{ id: string; name: string; key: string | null; fieldKey: string | null }>;
  errors: string[];
};

export type GhlSnapshotFreshness = "fresh" | "expired" | "future" | "malformed";

export type GhlConfigMappingStatus = "ready" | "missing" | "omitted" | "unresolved" | "duplicate" | "name_only";

export type GhlConfigMappingReview = {
  key: string;
  label: string;
  required: boolean;
  fieldId: string | null;
  status: GhlConfigMappingStatus;
  detail: string;
};

export type GhlConfigReview = {
  locationStatus: "missing" | "disconnected" | "ready";
  locationDetail: string;
  workflowStatus: "missing" | "unresolved" | "ready";
  workflowDetail: string;
  snapshotStatus: "missing" | "previously_captured" | GhlSnapshotFreshness;
  snapshotDetail: string;
  rows: GhlConfigMappingReview[];
  blockers: string[];
  canSubmit: boolean;
  webformNote: string | null;
};

export type GhlConfigProgressStep = {
  id: "location_selected" | "workflow_selected" | "fields_mapped" | "request_saved" | "awaiting_application";
  label: string;
  state: "complete" | "current" | "waiting";
  detail: string;
};

export type GhlConfigLocationChoice = {
  locationId: string;
  locationName: string | null;
  connectionStatus: string;
  lastError: string | null;
};

type SaveSuccess = {
  requestId: string;
  revision: number;
  replayed: boolean;
  locationId: string;
  workflowId: string;
  fieldMappings: GhlConfigFieldMapping[];
  snapshotFetchedAt: string;
};

export function emptyGhlConfigDraft(): GhlConfigDraft {
  return { locationId: "", workflowId: "", mappings: {} };
}

export function draftFromStoredRequest(stored: GhlConfigStoredRequest | null): GhlConfigDraft {
  if (!stored) return emptyGhlConfigDraft();
  const mappings: Record<string, string> = {};
  for (const row of stored.fieldMappings) mappings[row.key] = row.fieldId;
  return { locationId: stored.locationId, workflowId: stored.workflowId, mappings };
}

export function assessGhlConfigSnapshotFreshness(fetchedAt: unknown, now: Date): GhlSnapshotFreshness {
  const parsed = parseTimestamp(fetchedAt);
  if (!parsed) return "malformed";
  if (now.getTime() - parsed.getTime() > GHL_CONFIG_SNAPSHOT_MAX_AGE_MS) return "expired";
  if (parsed.getTime() - now.getTime() > GHL_CONFIG_SNAPSHOT_FUTURE_SKEW_MS) return "future";
  return "fresh";
}

export function presentGhlLocationPreview(input: {
  locationId: string;
  reportedLocationId?: unknown;
  workflows?: unknown;
  customFields?: unknown;
  fetchedAt?: unknown;
  fromCache?: unknown;
  snapshotVerification?: unknown;
  errors?: unknown;
}): GhlLocationPreview | null {
  const locationId = input.locationId.trim();
  const reported = text(input.reportedLocationId);
  if (!locationId) return null;
  if (reported && reported !== locationId) return null;
  const workflows = Array.isArray(input.workflows)
    ? input.workflows.flatMap((workflow) => {
        const record = asRecord(workflow);
        const id = text(record?.id);
        if (!id) return [];
        return [{ id, name: text(record?.name) ?? id }];
      })
    : [];
  const fields = Array.isArray(input.customFields)
    ? input.customFields.flatMap((field) => {
        const record = asRecord(field);
        const id = text(record?.id);
        if (!id) return [];
        return [{ id, name: text(record?.name) ?? id, key: text(record?.key), fieldKey: text(record?.fieldKey) }];
      })
    : [];
  const errors = Array.isArray(input.errors)
    ? input.errors.flatMap((error) => {
        const message = text(error);
        return message ? [message] : [];
      })
    : [];
  const verification = text(input.snapshotVerification);
  return {
    locationId,
    fetchedAt: text(input.fetchedAt),
    fromCache: input.fromCache === true,
    snapshotVerification:
      verification === "live" || verification === "cached" || verification === "previously_captured"
        ? verification
        : null,
    workflows,
    fields,
    errors,
  };
}

export function parseGhlConfigHead(value: unknown): GhlConfigHead | null {
  const record = asRecord(value);
  if (!record || record.ok !== true || !boundaryClear(record)) return null;
  const clientAccountId = text(record.clientAccountId);
  const revision = revisionOf(record.revision);
  if (!clientAccountId || revision === null) return null;
  if (record.destinationUpdatedAt !== null && text(record.destinationUpdatedAt) === null) return null;
  if (typeof record.liveDestination !== "boolean") return null;
  const configuration = record.configuration === null ? null : parseStored(record.configuration);
  if (record.configuration !== null && !configuration) return null;
  return {
    clientAccountId,
    revision,
    destinationUpdatedAt: record.destinationUpdatedAt === null ? null : text(record.destinationUpdatedAt),
    liveDestination: record.liveDestination,
    configuration,
  };
}

export function parseGhlConfigSaveResult(value: unknown): SaveSuccess | null {
  const record = asRecord(value);
  if (!record || record.ok !== true || record.status !== "stored" || !boundaryClear(record)) return null;
  const stored = parseStored({
    requestId: record.requestId,
    revision: record.revision,
    locationId: record.locationId,
    workflowId: record.workflowId,
    fieldMappings: record.fieldMappings,
    snapshotFetchedAt: record.snapshotFetchedAt,
    createdAt: record.snapshotFetchedAt,
  });
  if (!stored || typeof record.replayed !== "boolean") return null;
  return { ...stored, replayed: record.replayed };
}

export function readGhlConfigError(value: unknown): string | null {
  const record = asRecord(value);
  if (!record || record.ok !== false || typeof record.error !== "string" || !ERROR_CODE.test(record.error)) return null;
  return record.error;
}

export function ghlConfigRequestErrorMessage(code: string): string {
  switch (code) {
    case "ghl_destination_config_request_disabled":
    case "feature_disabled":
    case "FEATURE_DISABLED":
      return "GoHighLevel configuration requests are turned off. Nothing was stored, and delivery was not turned on.";
    case "forbidden":
      return "Portal access and observer access cannot store a GoHighLevel configuration request. Nothing was stored.";
    case "location_not_linked":
      return "That location is missing or disconnected for this client. Connect the location before saving a request. This page does not link a client.";
    case "live_destination":
      return "A live operational destination already exists. The configuration request was not stored, and the live destination was not changed.";
    case "snapshot_missing":
      return "This location has no snapshot. Load or refresh its snapshot, then submit again. Nothing was stored.";
    case "snapshot_expired":
      return "The location snapshot is older than 24 hours. Refresh it, then submit again. Nothing was stored.";
    case "snapshot_future":
      return "The location snapshot is dated ahead of the server. Refresh it, then submit again. Nothing was stored.";
    case "snapshot_unusable":
      return "The location snapshot time could not be read. Refresh it, then submit again. Nothing was stored.";
    case "snapshot_not_current":
      return "The newest location snapshot is not a complete GoHighLevel discovery. An earlier snapshot was not used as current verification. Refresh the location, then submit again. Nothing was stored.";
    case "workflow_not_in_snapshot":
      return "That workflow id is not in this location's snapshot. A workflow name was not used in its place. Nothing was stored.";
    case "field_id_unverified":
      return "A mapped value is not a custom-field id in this location's snapshot. A field name or key was not substituted. Nothing was stored.";
    case "duplicate_field_mapping":
      return "The same custom-field id is mapped more than once. Choose a different id for each field. Nothing was stored.";
    case "invalid_field_key":
      return "One of the mapped fields is not a supported field. Nothing was stored.";
    case "invalid_body":
      return "The configuration request was rejected. Check the location, workflow id, and field ids. Nothing was stored.";
    case "destination_stale":
      return "The operational destination changed after this page was loaded. Reload it before submitting again. Nothing was stored.";
    case "revision_conflict":
      return "The configuration request chain changed. Reload the stored request before submitting again. Nothing was stored.";
    case "request_id_reused":
      return "This request id was already used with a different payload. Reload and reconcile it before starting another request. Nothing new was stored.";
    case "destination_busy":
      return "The destination is busy. Retry uses the same request id. Nothing was stored yet.";
    case "client_not_found":
      return "This client was not found. Nothing was stored.";
    default:
      return "The configuration request was not stored. The operational destination was not changed.";
  }
}

export function buildGhlConfigSubmitBody(input: {
  requestId: string;
  head: GhlConfigHead;
  draft: GhlConfigDraft;
}): GhlConfigSubmitBody | null {
  if (!UUID.test(input.requestId)) return null;
  if (!Number.isSafeInteger(input.head.revision) || input.head.revision < 0) return null;
  const locationId = input.draft.locationId.trim();
  const workflowId = input.draft.workflowId.trim();
  if (!locationId || !workflowId) return null;
  const fieldMappings = normalizeMappings(input.draft.mappings);
  return {
    requestId: input.requestId,
    expectedRevision: input.head.revision,
    expectedDestinationUpdatedAt: input.head.destinationUpdatedAt,
    locationId,
    workflowId,
    fieldMappings,
  };
}

export function sameGhlConfigSubmitBody(left: GhlConfigSubmitBody, right: GhlConfigSubmitBody): boolean {
  return JSON.stringify(canonicalBody(left)) === JSON.stringify(canonicalBody(right));
}

export function surveyMappingsComplete(mappings: GhlConfigFieldMapping[]): boolean {
  const byKey = new Map(mappings.map((row) => [row.key, row.fieldId.trim()]));
  const ids = mappings.map((row) => row.fieldId.trim()).filter(Boolean);
  if (new Set(ids).size !== ids.length) return false;
  return GUIDED_GHL_SURVEY_KEYS.every((key) => Boolean(byKey.get(key)));
}

export function presentGhlConfigRequestProgress(head: GhlConfigHead | null): GhlConfigProgressStep[] {
  const stored = head?.configuration ?? null;
  const locationDone = Boolean(stored?.locationId);
  const workflowDone = Boolean(stored?.workflowId);
  const fieldsDone = stored ? surveyMappingsComplete(stored.fieldMappings) : false;
  const saved = Boolean(stored);
  return [
    {
      id: "location_selected",
      label: "Location selected",
      state: locationDone ? "complete" : "current",
      detail: locationDone ? `Stored location ${stored?.locationId}.` : "No location is stored on the configuration request.",
    },
    {
      id: "workflow_selected",
      label: "Workflow selected",
      state: workflowDone ? "complete" : locationDone ? "current" : "waiting",
      detail: workflowDone ? `Stored workflow id ${stored?.workflowId}.` : "No workflow id is stored on the configuration request.",
    },
    {
      id: "fields_mapped",
      label: "Fields mapped",
      state: fieldsDone ? "complete" : workflowDone ? "current" : "waiting",
      detail: fieldsDone
        ? "Desired coverage, branch of service, and primary reason are stored as distinct field ids."
        : "The stored request does not yet map desired coverage, branch of service, and primary reason to distinct field ids.",
    },
    {
      id: "request_saved",
      label: "Configuration request saved",
      state: saved ? "complete" : "waiting",
      detail: saved
        ? `Stored request ${stored?.requestId} at revision ${stored?.revision}. This is not an operational destination.`
        : "No configuration request is stored.",
    },
    {
      id: "awaiting_application",
      label: "Awaiting operational application",
      state: saved ? "current" : "waiting",
      detail: saved
        ? "The request is waiting for a separate operational step. Delivery stays off, and the saved destination was not changed."
        : "Operational application stays unavailable until a configuration request is stored.",
    },
  ];
}

export function reviewGhlConfigDraft(input: {
  draft: GhlConfigDraft;
  preview: GhlLocationPreview | null;
  locations: GhlConfigLocationChoice[];
  liveDestination: boolean;
  operationalUpdatedAt?: string | null;
  head: GhlConfigHead | null;
  now?: Date;
}): GhlConfigReview {
  const now = input.now ?? new Date();
  const locationId = input.draft.locationId.trim();
  const location = input.locations.find((item) => item.locationId === locationId) ?? null;
  const preview = input.preview && input.preview.locationId === locationId ? input.preview : null;
  const locationStatus = !locationId ? "missing" : !location || location.connectionStatus !== "connected" ? "disconnected" : "ready";
  const locationDetail =
    locationStatus === "missing"
      ? "Choose a connected location. Choosing one does not save it."
      : locationStatus === "disconnected"
        ? disconnectedDetail(locationId, location)
        : `${location?.locationName ?? locationId} (${locationId}) is connected. This choice is not saved yet.`;

  const freshness = preview ? assessGhlConfigSnapshotFreshness(preview.fetchedAt, now) : null;
  const snapshotStatus =
    preview?.snapshotVerification === "previously_captured" ? "previously_captured" : freshness ?? "missing";
  const snapshotDetail = snapshotCopy(snapshotStatus, preview);

  const workflowId = input.draft.workflowId.trim();
  const workflow = preview?.workflows.find((item) => item.id === workflowId) ?? null;
  const workflowStatus = !workflowId ? "missing" : workflow ? "ready" : "unresolved";
  const workflowDetail = workflowCopy(workflowStatus, workflowId, workflow);
  const webformNote = webformCopy(preview?.workflows ?? [], workflowId);

  const fieldIds = new Set(preview?.fields.map((field) => field.id) ?? []);
  const counts = new Map<string, number>();
  for (const value of Object.values(input.draft.mappings)) {
    const token = value.trim();
    if (!token) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const rows = [...GUIDED_GHL_SURVEY_KEYS, ...GHL_CONFIG_LOGICAL_FIELD_KEYS].map((key) => {
    const fieldId = input.draft.mappings[key]?.trim() || null;
    return reviewMapping({
      key,
      required: (GUIDED_GHL_SURVEY_KEYS as readonly string[]).includes(key),
      fieldId,
      fields: preview?.fields ?? [],
      fieldIds,
      duplicate: Boolean(fieldId && (counts.get(fieldId) ?? 0) > 1),
      previewLoaded: Boolean(preview),
    });
  });

  const blockers: string[] = [];
  if (input.liveDestination || input.head?.liveDestination) {
    blockers.push("A live operational destination already exists. A configuration request cannot be stored over it.");
  }
  if (locationStatus === "missing") blockers.push(locationDetail);
  if (locationStatus === "disconnected") blockers.push(locationDetail);
  if (snapshotStatus !== "fresh") blockers.push(snapshotDetail);
  if (workflowStatus !== "ready") blockers.push(workflowDetail);
  for (const error of preview?.errors ?? []) blockers.push(error);
  for (const row of rows) {
    if (!row.required && (row.status === "omitted" || row.status === "ready")) continue;
    if (row.status !== "ready") blockers.push(`${row.label}: ${row.detail}`);
  }
  if (
    input.head &&
    input.operationalUpdatedAt !== undefined &&
    (input.operationalUpdatedAt ?? null) !== input.head.destinationUpdatedAt
  ) {
    blockers.push("The operational destination time does not match the configuration request. Reload both before submitting.");
  }
  for (const [key, fieldId] of Object.entries(input.draft.mappings)) {
    if (!fieldId.trim()) continue;
    if (!FIELD_KEYS.has(key)) blockers.push(`${key} is not a supported field. It was not replaced with another field.`);
  }

  return {
    locationStatus,
    locationDetail,
    workflowStatus,
    workflowDetail,
    snapshotStatus,
    snapshotDetail,
    rows,
    blockers,
    canSubmit: blockers.length === 0,
    webformNote,
  };
}

export function formatGhlConfigTimestamp(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function reviewMapping(input: {
  key: string;
  required: boolean;
  fieldId: string | null;
  fields: GhlLocationPreview["fields"];
  fieldIds: Set<string>;
  duplicate: boolean;
  previewLoaded: boolean;
}): GhlConfigMappingReview {
  const label = fieldLabel(input.key);
  if (input.duplicate && input.fieldId) {
    return {
      key: input.key,
      label,
      required: input.required,
      fieldId: input.fieldId,
      status: "duplicate",
      detail: "This field id is used by more than one mapping.",
    };
  }
  if (!input.fieldId) {
    const suggestion = input.previewLoaded
      ? fieldSuggestions({ key: input.key, fields: input.fields as DiscoveredDestinationField[] })
      : null;
    if (suggestion && suggestion.fields.length > 0) {
      const names = suggestion.fields.map((field) => field.name).join(", ");
      return {
        key: input.key,
        label,
        required: input.required,
        fieldId: null,
        status: "name_only",
        detail: `${names} matches the display name. That match was not selected as the field id.`,
      };
    }
    return {
      key: input.key,
      label,
      required: input.required,
      fieldId: null,
      status: input.required ? "missing" : "omitted",
      detail: input.required ? "Choose an explicit field id." : "Not mapped.",
    };
  }
  if (!input.previewLoaded) {
    return {
      key: input.key,
      label,
      required: input.required,
      fieldId: input.fieldId,
      status: "unresolved",
      detail: "Load this location's snapshot before this field id can be checked.",
    };
  }
  if (input.fieldIds.has(input.fieldId)) {
    const match = input.fields.find((field) => field.id === input.fieldId);
    return {
      key: input.key,
      label,
      required: input.required,
      fieldId: input.fieldId,
      status: "ready",
      detail: `Field id ${input.fieldId}${match ? ` (${match.name})` : ""}.`,
    };
  }
  const byKey = input.fields.find((field) => field.fieldKey === input.fieldId || field.key === input.fieldId);
  const byName = input.fields.find((field) => field.name === input.fieldId);
  const why = byKey
    ? "This value matches a field key, not a field id. It was not replaced with the id."
    : byName
      ? "This value matches a display name, not a field id. It was not replaced with the id."
      : "This value is not a field id in this location's snapshot.";
  return {
    key: input.key,
    label,
    required: input.required,
    fieldId: input.fieldId,
    status: "unresolved",
    detail: why,
  };
}

function disconnectedDetail(locationId: string, location: GhlConfigLocationChoice | null): string {
  if (!location) {
    return `Location ${locationId} is not a connected location for this client. This page does not link a client.`;
  }
  const error = location.lastError ? ` ${location.lastError}` : "";
  return `Location ${location.locationName ?? locationId} is ${location.connectionStatus || "not connected"}.${error} Connect it before saving a request. This page does not link a client.`;
}

function snapshotCopy(status: GhlConfigReview["snapshotStatus"], preview: GhlLocationPreview | null): string {
  if (status === "missing") return "Load this location's snapshot. A snapshot from another location is not used.";
  if (status === "previously_captured") {
    return "This snapshot was previously captured. It is not current GoHighLevel verification. Refresh the location before submitting.";
  }
  if (status === "expired") return "This location's snapshot is older than 24 hours. Refresh it before submitting.";
  if (status === "future") return "This location's snapshot is dated ahead of the server. Refresh it before submitting.";
  if (status === "malformed") return "This location's snapshot time could not be read. Refresh it before submitting.";
  const when = formatGhlConfigTimestamp(preview?.fetchedAt ?? null);
  return when ? `Snapshot for this location was read ${when}.` : "Snapshot for this location is ready.";
}

function workflowCopy(
  status: GhlConfigReview["workflowStatus"],
  workflowId: string,
  workflow: { id: string; name: string } | null
): string {
  if (status === "missing") return "Choose a workflow by its id. A name containing Webform is not selected automatically.";
  if (status === "unresolved") return `Workflow id ${workflowId} is not in this location's snapshot. A workflow name was not substituted.`;
  const named = workflow?.name && /webform/i.test(workflow.name) ? " The Webform name was not used to select it." : "";
  return `Workflow id ${workflowId}${workflow?.name ? ` (${workflow.name})` : ""}.${named}`;
}

function webformCopy(workflows: Array<{ id: string; name: string }>, selectedId: string): string | null {
  const named = workflows.filter((workflow) => /webform/i.test(workflow.name));
  if (named.length === 0) return null;
  if (!selectedId) return "A workflow name containing Webform is listed. It is not selected until you choose its id.";
  return "Workflow names that contain Webform stay labels. Only the selected workflow id is submitted.";
}

function fieldLabel(key: string): string {
  if ((GUIDED_GHL_SURVEY_KEYS as readonly string[]).includes(key)) {
    return GUIDED_GHL_SURVEY_LABELS[key as (typeof GUIDED_GHL_SURVEY_KEYS)[number]];
  }
  const words = key.replace(/^sa360_/, "SA360 ").replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function normalizeMappings(mappings: Record<string, string>): GhlConfigFieldMapping[] {
  return Object.entries(mappings)
    .map(([key, fieldId]) => ({ key: key.trim(), fieldId: fieldId.trim() }))
    .filter((row) => row.key && row.fieldId)
    .sort((left, right) => left.key.localeCompare(right.key));
}

function canonicalBody(body: GhlConfigSubmitBody) {
  return {
    requestId: body.requestId,
    expectedRevision: body.expectedRevision,
    expectedDestinationUpdatedAt: body.expectedDestinationUpdatedAt,
    locationId: body.locationId.trim(),
    workflowId: body.workflowId.trim(),
    fieldMappings: [...body.fieldMappings]
      .map((row) => ({ key: row.key.trim(), fieldId: row.fieldId.trim() }))
      .sort((left, right) => left.key.localeCompare(right.key)),
  };
}

function parseStored(value: unknown): GhlConfigStoredRequest | null {
  const record = asRecord(value);
  if (!record) return null;
  const requestId = text(record.requestId);
  const revision = revisionOf(record.revision);
  const locationId = text(record.locationId);
  const workflowId = text(record.workflowId);
  const snapshotFetchedAt = text(record.snapshotFetchedAt);
  const createdAt = text(record.createdAt);
  const fieldMappings = parseMappings(record.fieldMappings);
  if (!requestId || !UUID.test(requestId) || revision === null || !locationId || !workflowId || !snapshotFetchedAt || !createdAt || !fieldMappings) {
    return null;
  }
  return { requestId, revision, locationId, workflowId, fieldMappings, snapshotFetchedAt, createdAt };
}

function parseMappings(value: unknown): GhlConfigFieldMapping[] | null {
  if (!Array.isArray(value)) return null;
  const rows: GhlConfigFieldMapping[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const key = text(record?.key);
    const fieldId = text(record?.fieldId);
    if (!key || !fieldId) return null;
    rows.push({ key, fieldId });
  }
  return rows;
}

function boundaryClear(record: Record<string, unknown>): boolean {
  return (
    record.destinationUpdated === false &&
    record.deliveryArmed === false &&
    record.enrollmentPerformed === false &&
    record.routingChanged === false &&
    record.liveDestinationChanged === false
  );
}

function revisionOf(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseTimestamp(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
