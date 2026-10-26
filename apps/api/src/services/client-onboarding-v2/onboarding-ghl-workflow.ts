/**
 * Read-only Select Time Zone discovery and location-API delivery evidence.
 *
 * Matching and selection validation are pure. The mock executor records contact
 * upsert, note POST, and direct workflow enrollment. It does not call GoHighLevel.
 * HTTP acceptance, contact id, note id, enrollment, and downstream execution stay
 * separate facts. Downstream execution is never inferred from a 2xx.
 */

import { extractContactIdFromGhlResponse } from "../ghl-delivery-adapter/ghl-live-transport.js";
import { buildLiveContactUpsertHttpBody } from "../ghl-delivery-adapter/ghl-delivery-request-builders.js";
import type { GhlContactUpsertPreview, GhlWorkflowStartPreview } from "../ghl-delivery-adapter/ghl-delivery-adapter.types.js";
import {
  ONBOARDING_LEAD_NOTE_CONTRACT,
  type OnboardingLeadNotePlan,
} from "../ghl-delivery-adapter/onboarding-lead-note.js";
import {
  normalizeWorkflowTriggerMode,
  WORKFLOW_TRIGGER_MODE_DEFAULT,
  type WorkflowTriggerMode,
} from "../ghl-delivery-adapter/ghl-workflow-trigger-mode.js";

export const SELECT_TIME_ZONE_WORKFLOW_NAME = "select time zone";

export const ONBOARDING_CONTACT_UPSERT_PATH = "/contacts/upsert" as const;
export const ONBOARDING_CONTACT_NOTE_PATH = "/contacts/:contactId/notes" as const;
export const ONBOARDING_WORKFLOW_ENROLLMENT_PATH: GhlWorkflowStartPreview["path"] =
  "/contacts/:contactId/workflow/:workflowId";

const CONTACT_UPSERT_BODY_KEYS = new Set([
  "locationId",
  "email",
  "phone",
  "source",
  "firstName",
  "lastName",
  "state",
]);

export const LOCATION_API_ONBOARDING_CAPABILITIES = {
  contactUpsert: {
    method: "POST" as const,
    path: ONBOARDING_CONTACT_UPSERT_PATH,
    customFieldsInOnboardingBody: false,
  },
  contactNote: {
    method: "POST" as const,
    path: ONBOARDING_CONTACT_NOTE_PATH,
    bodyKeys: ["title", "body"] as const,
  },
  workflowEnrollment: {
    method: "POST" as const,
    path: ONBOARDING_WORKFLOW_ENROLLMENT_PATH,
  },
  introducesCustomFields: false,
  createsWorkflow: false,
} as const;

/**
 * Work that stays outside this PR. Selection persistence uses columns that
 * already exist; notesEnabled does not, and this lane does not add a migration.
 */
export const ONBOARDING_GHL_INTEGRATION_REMAINING = [
  "Mount adminClientOnboardingV2GhlRoutes in apps/api/src/app.ts under /admin/v1. This PR does not edit app.ts.",
  "Point workflow discovery at a read-only GhlDiscoveredWorkflow snapshot from existing config discovery. Do not call live GHL and do not create a workflow.",
  "Apply SelectTimeZoneSelectionPatch on the existing ClientGhlDestination row for this client only: destinationWorkflowIdGhl and workflowTriggerMode=direct_api. No new model is required for that patch. Do not change deliveryEnabled, clientCutoverApproved, campaignDispatchEnabled, or agedDispatchEnabled.",
  "Store notesEnabled and notesContractVersion sa360_lead_note_v2 outside ClientGhlDestination columns. That store waits for the Auth/Account migration.",
  "Captured delivery calls buildOnboardingLeadNote, then POST /contacts/upsert, POST /contacts/:contactId/notes, and POST /contacts/:contactId/workflow/:workflowId. Reuse the existing transport. Do not edit ghl-live-transport.ts and do not add custom fields.",
  "Captured tests use onboarding-test:{testRunId}:ghl-note:{part}. They must not write a production ghl-note: key.",
  "Confirm SA360_GHL_NOTE_BODY_MAX_CHARS against the provider limit before the first live POST. The default remains 10000.",
  "Leave SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED unset. Do not arm delivery flags or change a live destination from this module.",
  "An enrollment HTTP 2xx does not prove downstream_executed. Operator attestation stays a later route.",
  "Do not add these onboarding paths to the Admin C.O.C. observer allowlist.",
] as const;

export type DiscoveredWorkflow = {
  id: string;
  name: string;
  status?: string | null;
  type?: string | null;
};

export type SelectTimeZoneMatch =
  | {
      workflowMatch: "unique";
      workflowId: string;
      workflowName: string;
      matches: DiscoveredWorkflow[];
      selectedWorkflowId: string;
    }
  | {
      workflowMatch: "workflow_not_found";
      error: "workflow_not_found";
      matches: [];
      selectedWorkflowId: null;
    }
  | {
      workflowMatch: "workflow_ambiguous";
      error: "workflow_ambiguous";
      matches: DiscoveredWorkflow[];
      selectedWorkflowId: null;
    };

export type ClientGhlDestinationSnapshot = {
  clientAccountId: string;
  revision?: number;
  destinationWorkflowIdGhl: string | null;
  workflowTriggerMode: string | null;
  deliveryEnabled: boolean;
  clientCutoverApproved: boolean;
};

export type SelectTimeZoneSelectionPatch = {
  destinationWorkflowIdGhl: string;
  workflowTriggerMode: "direct_api";
};

export type SelectTimeZoneSelection =
  | {
      ok: true;
      patch: SelectTimeZoneSelectionPatch;
      workflowId: string;
      workflowName: string;
      preserved: {
        deliveryEnabled: boolean;
        clientCutoverApproved: boolean;
      };
    }
  | {
      ok: false;
      error: "workflow_not_found" | "workflow_ambiguous" | "workflow_name_mismatch" | "revision_conflict" | "client_account_mismatch";
      matches?: DiscoveredWorkflow[];
    };

export function workflowNameMatchesSelectTimeZone(name: string): boolean {
  return name.trim().toLowerCase() === SELECT_TIME_ZONE_WORKFLOW_NAME;
}

export function matchSelectTimeZoneWorkflows(workflows: readonly DiscoveredWorkflow[]): SelectTimeZoneMatch {
  const matches = workflows.filter((workflow) => workflowNameMatchesSelectTimeZone(workflow.name));
  if (matches.length === 1) {
    const match = matches[0]!;
    return {
      workflowMatch: "unique",
      workflowId: match.id,
      workflowName: match.name,
      matches: [match],
      selectedWorkflowId: match.id,
    };
  }
  if (matches.length === 0) {
    return {
      workflowMatch: "workflow_not_found",
      error: "workflow_not_found",
      matches: [],
      selectedWorkflowId: null,
    };
  }
  return {
    workflowMatch: "workflow_ambiguous",
    error: "workflow_ambiguous",
    matches: matches.map((match) => ({ ...match })),
    selectedWorkflowId: null,
  };
}

/**
 * A destination that has not been through Select Time Zone selection keeps the
 * existing default. This function does not write the row.
 */
export function workflowTriggerModeBeforeSelection(mode: string | null | undefined): WorkflowTriggerMode {
  if (mode === undefined || mode === null || mode === "") return WORKFLOW_TRIGGER_MODE_DEFAULT;
  return normalizeWorkflowTriggerMode(mode);
}

export function validateSelectTimeZoneSelection(input: {
  clientAccountId: string;
  expectedRevision?: number;
  destination: ClientGhlDestinationSnapshot | null;
  workflows: readonly DiscoveredWorkflow[];
  discoveredWorkflowId: string;
  discoveredName: string;
}): SelectTimeZoneSelection {
  const clientAccountId = input.clientAccountId.trim();
  if (input.destination && input.destination.clientAccountId !== clientAccountId) {
    return { ok: false, error: "client_account_mismatch" };
  }
  if (
    input.destination &&
    input.destination.revision !== undefined &&
    input.expectedRevision !== undefined &&
    input.destination.revision !== input.expectedRevision
  ) {
    return { ok: false, error: "revision_conflict" };
  }

  const classified = matchSelectTimeZoneWorkflows(input.workflows);
  if (classified.workflowMatch === "workflow_ambiguous") {
    return { ok: false, error: "workflow_ambiguous", matches: classified.matches };
  }
  if (!workflowNameMatchesSelectTimeZone(input.discoveredName)) {
    return { ok: false, error: "workflow_name_mismatch" };
  }

  const requestedId = input.discoveredWorkflowId.trim();
  const snapshot = input.workflows.find((workflow) => workflow.id === requestedId);
  if (!snapshot) return { ok: false, error: "workflow_not_found" };
  if (!workflowNameMatchesSelectTimeZone(snapshot.name)) {
    return { ok: false, error: "workflow_name_mismatch" };
  }
  if (classified.workflowMatch !== "unique" || classified.workflowId !== requestedId) {
    return { ok: false, error: "workflow_not_found" };
  }

  const deliveryEnabled = input.destination?.deliveryEnabled ?? false;
  const clientCutoverApproved = input.destination?.clientCutoverApproved ?? false;
  return {
    ok: true,
    workflowId: snapshot.id,
    workflowName: snapshot.name,
    patch: {
      destinationWorkflowIdGhl: snapshot.id,
      workflowTriggerMode: "direct_api",
    },
    preserved: { deliveryEnabled, clientCutoverApproved },
  };
}

/** In-memory application of a validated patch. Does not touch delivery switches. */
export function applySelectTimeZoneSelection(
  destination: ClientGhlDestinationSnapshot,
  patch: SelectTimeZoneSelectionPatch
): ClientGhlDestinationSnapshot {
  return {
    ...destination,
    destinationWorkflowIdGhl: patch.destinationWorkflowIdGhl,
    workflowTriggerMode: patch.workflowTriggerMode,
  };
}

export type LocationApiCall = {
  method: "POST";
  path: string;
  body: Record<string, unknown>;
  idempotencyKey?: string;
};

export type LocationApiMockResponse = {
  httpStatus: number;
  body?: unknown;
  outcome?: "ok" | "failed" | "uncertain";
};

export type LocationApiMockTransport = (
  call: LocationApiCall
) => LocationApiMockResponse | Promise<LocationApiMockResponse>;

export type LocationApiProof = {
  http_accepted: boolean;
  contact_upserted: boolean;
  note_persisted: boolean;
  workflow_enrolled: boolean;
  downstream_executed: false;
  workflowApiCalled: boolean;
  triggerTagPlanned: boolean;
  notePartial: boolean;
  posted: boolean;
  contactId: string | null;
  noteIds: string[];
  calls: LocationApiCall[];
  error: "note_too_long" | "note_partial" | "custom_fields_forbidden" | null;
};

export type LocationApiDeliveryInput = {
  locationId: string;
  contact: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    state?: string | null;
    source?: string | null;
  };
  notePlan: OnboardingLeadNotePlan;
  notesEnabled: boolean;
  workflowTriggerMode: WorkflowTriggerMode;
  workflowId: string | null;
  transport: LocationApiMockTransport;
};

export async function executeOnboardingLocationApiDelivery(
  input: LocationApiDeliveryInput
): Promise<LocationApiProof> {
  const calls: LocationApiCall[] = [];
  const responses: LocationApiMockResponse[] = [];
  let allAccepted = true;

  const send = async (call: LocationApiCall): Promise<LocationApiMockResponse> => {
    if (hasCustomFields(call.body)) {
      throw new CustomFieldsForbidden();
    }
    calls.push(call);
    const response = await input.transport(call);
    responses.push(response);
    if (classifyHttp(response) !== "accepted") allAccepted = false;
    return response;
  };

  if (input.notePlan.status === "note_too_long") {
    return emptyProof({
      calls,
      error: "note_too_long",
      triggerTagPlanned: input.workflowTriggerMode === "tag_trigger",
    });
  }

  const upsertBody = onboardingContactUpsertBody(input.locationId, input.contact);
  if (upsertBody === null) {
    return emptyProof({ calls, error: "custom_fields_forbidden" });
  }

  let upsertResponse: LocationApiMockResponse;
  try {
    upsertResponse = await send({
      method: "POST",
      path: ONBOARDING_CONTACT_UPSERT_PATH,
      body: upsertBody,
    });
  } catch (error) {
    if (error instanceof CustomFieldsForbidden) {
      return emptyProof({ calls, error: "custom_fields_forbidden" });
    }
    throw error;
  }

  const contactId =
    classifyHttp(upsertResponse) === "accepted"
      ? extractContactIdFromGhlResponse(upsertResponse.body)
      : null;
  if (!contactId) {
    return {
      ...emptyProof({
        calls,
        triggerTagPlanned: input.workflowTriggerMode === "tag_trigger",
      }),
      http_accepted: allAccepted && calls.length > 0,
    };
  }

  const noteIds: string[] = [];
  let notesStopped = false;
  if (input.notesEnabled) {
    for (const part of input.notePlan.parts) {
      const noteResponse = await send({
        method: "POST",
        path: `/contacts/${encodeURIComponent(contactId)}/notes`,
        body: { title: part.title, body: part.body },
        idempotencyKey: part.idempotencyKey,
      });
      const noteId = classifyHttp(noteResponse) === "accepted" ? extractNoteId(noteResponse.body) : null;
      if (!noteId) {
        notesStopped = true;
        break;
      }
      noteIds.push(noteId);
    }
  }

  const notesRequired = input.notesEnabled && input.notePlan.parts.length > 0;
  const notesComplete = !notesRequired || noteIds.length === input.notePlan.parts.length;
  let workflowApiCalled = false;
  let workflowEnrolled = false;

  if (notesComplete && input.workflowTriggerMode === "direct_api" && input.workflowId) {
    const workflowResponse = await send({
      method: "POST",
      path: `/contacts/${encodeURIComponent(contactId)}/workflow/${encodeURIComponent(input.workflowId)}`,
      body: { locationId: input.locationId },
    });
    workflowApiCalled = true;
    workflowEnrolled = classifyHttp(workflowResponse) === "accepted";
  }

  return {
    http_accepted: allAccepted && responses.length === calls.length && calls.length > 0,
    contact_upserted: true,
    note_persisted: notesRequired && noteIds.length === input.notePlan.parts.length,
    workflow_enrolled: workflowEnrolled,
    downstream_executed: false,
    workflowApiCalled,
    triggerTagPlanned: input.workflowTriggerMode === "tag_trigger",
    notePartial: notesStopped,
    posted: notesRequired && notesComplete,
    contactId,
    noteIds,
    calls,
    error: notesStopped ? "note_partial" : null,
  };
}

export function proofFromInboundWebhookAcceptance(httpStatus: number): LocationApiProof {
  const accepted = httpStatus >= 200 && httpStatus < 300;
  return {
    http_accepted: accepted,
    contact_upserted: false,
    note_persisted: false,
    workflow_enrolled: false,
    downstream_executed: false,
    workflowApiCalled: false,
    triggerTagPlanned: false,
    notePartial: false,
    posted: false,
    contactId: null,
    noteIds: [],
    calls: [],
    error: null,
  };
}

export function onboardingContactUpsertBody(
  locationId: string,
  contact: LocationApiDeliveryInput["contact"]
): Record<string, unknown> | null {
  const preview: GhlContactUpsertPreview = {
    method: "POST",
    path: "/contacts/upsert",
    locationId,
    body: {
      firstName: blankToNull(contact.firstName),
      lastName: blankToNull(contact.lastName),
      email: blankToNull(contact.email),
      phone: blankToNull(contact.phone),
      state: blankToNull(contact.state),
      source: blankToNull(contact.source) ?? "sa360",
      customFields: {},
    },
  };
  const body = buildLiveContactUpsertHttpBody(preview);
  if (hasCustomFields(body)) return null;
  for (const key of Object.keys(body)) {
    if (!CONTACT_UPSERT_BODY_KEYS.has(key)) return null;
  }
  return body;
}

export function splitLeadName(fullName: string | null | undefined): {
  firstName: string | null;
  lastName: string | null;
} {
  const trimmed = fullName?.trim() ?? "";
  if (!trimmed) return { firstName: null, lastName: null };
  const parts = trimmed.split(/\s+/);
  const firstName = parts[0] ?? null;
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
  return { firstName, lastName };
}

function classifyHttp(response: LocationApiMockResponse): "accepted" | "failed" | "uncertain" {
  if (response.outcome === "uncertain" || response.httpStatus === 0 || response.httpStatus >= 500) {
    return "uncertain";
  }
  if (response.outcome === "failed") return "failed";
  if (response.httpStatus >= 200 && response.httpStatus < 300) return "accepted";
  return "failed";
}

function extractNoteId(json: unknown): string | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const root = json as Record<string, unknown>;
  const note = root.note;
  if (note && typeof note === "object" && !Array.isArray(note)) {
    const id = (note as Record<string, unknown>).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  for (const key of ["id", "noteId"]) {
    const value = root[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

class CustomFieldsForbidden extends Error {
  constructor() {
    super("custom_fields_forbidden");
    this.name = "CustomFieldsForbidden";
  }
}

function hasCustomFields(body: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(body, "customFields") ||
    Object.prototype.hasOwnProperty.call(body, "customField")
  );
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function emptyProof(input: {
  calls: LocationApiCall[];
  error?: LocationApiProof["error"];
  triggerTagPlanned?: boolean;
}): LocationApiProof {
  return {
    http_accepted: false,
    contact_upserted: false,
    note_persisted: false,
    workflow_enrolled: false,
    downstream_executed: false,
    workflowApiCalled: false,
    triggerTagPlanned: input.triggerTagPlanned ?? false,
    notePartial: false,
    posted: false,
    contactId: null,
    noteIds: [],
    calls: input.calls,
    error: input.error ?? null,
  };
}

export const ONBOARDING_LOCATION_API_CONTRACT = ONBOARDING_LEAD_NOTE_CONTRACT;
