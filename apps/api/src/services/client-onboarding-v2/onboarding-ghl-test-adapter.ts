/**
 * Controlled location-API adapter for one onboarding captured-event test.
 *
 * This is a separate port. It is not mounted in `onboarding-execution-binding.ts`
 * and it does not call `ghlLiveJson`. That transport retries HTTP 429 and 5xx
 * and is gated on live canary writes. This adapter posts each operation once.
 *
 * It reuses the existing location connection (`resolveGhlBearerAuthForLocation`),
 * the location API base URL and `Version: 2021-07-28` header, the contact upsert
 * body the location client already accepts, Agent B's `sa360_lead_note_v2`
 * formatter, and Select Time Zone discovery validation.
 *
 * No live GoHighLevel write is authorized. Delivery is refused unless the
 * captured-test flag and the adapter approval flag are exactly `"true"`, and
 * the API base URL is a loopback HTTPS host. Production hosts never receive a
 * contact, note, or workflow POST from this module.
 */

import { getGhlOAuthApiBaseUrl } from "../../lib/ghl-oauth-env.js";
import { getGhlWorkspaceSyncTimeoutMs } from "../../lib/ghl-workspace-sync-env.js";
import {
  extractContactIdFromGhlResponse,
  parseGhlApiErrorSummary,
} from "../ghl-delivery-adapter/ghl-live-transport.js";
import {
  buildOnboardingLeadNote,
  resolveGhlNoteBodyMaxChars,
  type OnboardingLeadNotePart,
  type OnboardingStoredLeadEvent,
} from "../ghl-delivery-adapter/onboarding-lead-note.js";
import { resolveGhlBearerAuthForLocation } from "../ghl-oauth/ghl-auth-resolver.service.js";
import {
  onboardingContactUpsertBody,
  splitLeadName,
  validateSelectTimeZoneSelection,
  workflowNameMatchesSelectTimeZone,
  type DiscoveredWorkflow,
} from "./onboarding-ghl-workflow.js";

/** Same version header the existing location API clients send. */
export const ONBOARDING_GHL_LOCATION_API_VERSION = "2021-07-28";

export const ONBOARDING_GHL_TEST_GLOBAL_FLAG = "SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED";

/**
 * Separate from the global captured-test flag. Exact `"true"` allows a
 * loopback mock delivery. It does not allow a production GoHighLevel host.
 */
export const ONBOARDING_GHL_TEST_ADAPTER_APPROVED_FLAG =
  "SA360_CLIENT_ONBOARDING_GHL_LOCATION_TEST_ADAPTER_APPROVED";

/**
 * Create Note (`POST /contacts/:contactId/notes`) types `body` as a string and
 * does not publish `maxLength`. The 5000-character appointment-note limit is a
 * different API and is not used here. This adapter will not transmit a part
 * above the reviewed onboarding default until a contact-note maximum is
 * published. A higher `SA360_GHL_NOTE_BODY_MAX_CHARS` is `unsupported_note_size`.
 */
export const GHL_CONTACT_NOTE_TRANSMIT_CEILING = 10_000;

export const ONBOARDING_GHL_TEST_ADAPTER_INTEGRATION =
  "Connect createOnboardingGhlTestAdapter in a later pass. Leave createFailClosedGhlPort in place. Do not point this port at a production GoHighLevel host.";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const PRODUCTION_KEY = /^(?:ghl-note|ghl-webhook|campaign|lead):/;
const REFUSED_HOSTS = new Set([
  "services.leadconnectorhq.com",
  "marketplace.leadconnectorhq.com",
  "api.leadconnectorhq.com",
  "rest.gohighlevel.com",
  "services.gohighlevel.com",
]);

const CONTACT_BODY_KEYS = new Set([
  "locationId",
  "email",
  "phone",
  "source",
  "firstName",
  "lastName",
  "state",
]);

export type OnboardingGhlTestAuthorization = {
  scope: "client";
  clientAccountId: string;
  testRunId: string;
  granted: boolean;
};

export type OnboardingGhlVerifiedTestIdentity = {
  email?: string | null;
  phoneE164?: string | null;
};

export type OnboardingGhlTestContact = {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  state?: string | null;
};

export type OnboardingGhlTestDeliveryRequest = {
  clientAccountId: string;
  testRunId: string;
  sourceLeadEventId: string;
  authorization: OnboardingGhlTestAuthorization;
  verifiedTestIdentity: OnboardingGhlVerifiedTestIdentity;
  contact: OnboardingGhlTestContact;
  event: OnboardingStoredLeadEvent;
  locationId: string;
  selectedLocationId: string;
  workflowId: string;
  workflowName: string;
  workflowTriggerMode: string;
  discoveredWorkflows: readonly DiscoveredWorkflow[];
  acknowledgeDownstreamAutomation: boolean;
  noteOverflow?: "refuse" | "split_continuation" | null;
};

export type OnboardingGhlTestEvidence = {
  http_accepted: boolean;
  contact_upserted: boolean;
  note_persisted: boolean;
  workflow_enrolled: boolean;
  downstream_executed: false;
};

export type OnboardingGhlCallClassification = "accepted" | "failed" | "uncertain" | "not_sent";

export type OnboardingGhlTestNoteReceipt = {
  part: number;
  idempotencyKey: string;
  noteId: string | null;
  httpStatus: number | null;
  classification: OnboardingGhlCallClassification;
  attempts: 0 | 1;
};

export type OnboardingGhlTestCallReceipt = {
  operation: "contact" | "note" | "workflow";
  method: "POST";
  path: string;
  idempotencyKey: string;
  httpStatus: number | null;
  classification: Exclude<OnboardingGhlCallClassification, "not_sent">;
  externalId: string | null;
  attempts: 1;
};

export type OnboardingGhlTestIdempotencyKeys = {
  contact: string;
  notes: string[];
  workflow: string;
};

export type OnboardingGhlTestDeliveryReceipt = {
  ok: boolean;
  posted: boolean;
  retried: false;
  externalCallExecuted: boolean;
  error: string | null;
  detail: string | null;
  evidence: OnboardingGhlTestEvidence;
  contactId: string | null;
  workflowId: string | null;
  idempotencyKeys: OnboardingGhlTestIdempotencyKeys | null;
  notes: OnboardingGhlTestNoteReceipt[];
  calls: OnboardingGhlTestCallReceipt[];
  configuredNoteBodyMaxChars: number | null;
  providerNoteBodyCeiling: typeof GHL_CONTACT_NOTE_TRANSMIT_CEILING;
};

export type OnboardingGhlLocationAuth = {
  token: string;
};

export type OnboardingGhlTestAdapterDeps = {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  /** Required for any POST. Production and non-loopback hosts are refused. */
  apiBaseUrl?: string;
  resolveAuth?: (locationId: string) => Promise<OnboardingGhlLocationAuth | null>;
  timeoutMs?: number;
};

export type OnboardingGhlTestAdapterPort = {
  deliver(request: OnboardingGhlTestDeliveryRequest): Promise<OnboardingGhlTestDeliveryReceipt>;
};

type PreparedDelivery = {
  locationId: string;
  workflowId: string;
  contactBody: Record<string, unknown>;
  parts: OnboardingLeadNotePart[];
  keys: OnboardingGhlTestIdempotencyKeys;
  configuredNoteBodyMaxChars: number;
};

type Refusal = {
  error: string;
  detail: string | null;
  keys: OnboardingGhlTestIdempotencyKeys | null;
  configuredNoteBodyMaxChars: number | null;
  notes: OnboardingGhlTestNoteReceipt[];
};

export function createOnboardingGhlTestAdapter(
  deps: OnboardingGhlTestAdapterDeps = {}
): OnboardingGhlTestAdapterPort {
  return {
    deliver(request) {
      return deliverOnboardingGhlCapturedTest(request, deps);
    },
  };
}

export async function deliverOnboardingGhlCapturedTest(
  request: OnboardingGhlTestDeliveryRequest,
  deps: OnboardingGhlTestAdapterDeps = {}
): Promise<OnboardingGhlTestDeliveryReceipt> {
  const prepared = prepareDelivery(request, deps.env ?? process.env);
  if ("error" in prepared) return refused(prepared);

  const base = resolveLoopbackBase(deps.apiBaseUrl ?? getGhlOAuthApiBaseUrl());
  if (!base.ok) {
    return refused({
      error: "live_ghl_write_not_authorized",
      detail: base.detail,
      keys: prepared.keys,
      configuredNoteBodyMaxChars: prepared.configuredNoteBodyMaxChars,
      notes: notSentNotes(prepared.parts, prepared.keys.notes),
    });
  }

  const resolveAuth = deps.resolveAuth ?? defaultResolveAuth;
  let auth: OnboardingGhlLocationAuth | null;
  try {
    auth = await resolveAuth(prepared.locationId);
  } catch {
    auth = null;
  }
  if (!auth?.token.trim()) {
    return refused({
      error: "ghl_location_connection_missing",
      detail: "No location token is available for the selected location.",
      keys: prepared.keys,
      configuredNoteBodyMaxChars: prepared.configuredNoteBodyMaxChars,
      notes: notSentNotes(prepared.parts, prepared.keys.notes),
    });
  }

  const fetchImpl = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? getGhlWorkspaceSyncTimeoutMs();
  const calls: OnboardingGhlTestCallReceipt[] = [];
  const notes: OnboardingGhlTestNoteReceipt[] = [];

  const upsert = await postOnce({
    fetchImpl,
    base: base.base,
    token: auth.token.trim(),
    timeoutMs,
    operation: "contact",
    path: "/contacts/upsert",
    idempotencyKey: prepared.keys.contact,
    body: prepared.contactBody,
  });
  if (!upsert.fetched) {
    return finish({
      prepared,
      calls,
      notes: notSentNotes(prepared.parts, prepared.keys.notes),
      contactId: null,
      error: "custom_fields_forbidden",
      detail: upsert.detail,
      contactUpserted: false,
    });
  }
  calls.push(upsert.call);

  const contactId =
    upsert.call.classification === "accepted" ? safeExternalId(extractContactIdFromGhlResponse(upsert.json)) : null;
  if (upsert.call.classification !== "accepted" || !contactId) {
    const uncertain = upsert.call.classification !== "failed";
    return finish({
      prepared,
      calls,
      notes: notSentNotes(prepared.parts, prepared.keys.notes),
      contactId: null,
      error: uncertain ? "contact_upsert_uncertain" : "contact_upsert_failed",
      detail: upsert.detail,
      contactUpserted: false,
    });
  }

  const seenNoteIds = new Set<string>();
  let notesStopped = false;
  let noteError: string | null = null;
  let noteDetail: string | null = null;

  for (let index = 0; index < prepared.parts.length; index += 1) {
    const part = prepared.parts[index]!;
    const idempotencyKey = prepared.keys.notes[index]!;
    if (notesStopped) {
      notes.push(noteReceipt(part.part, idempotencyKey, null, null, "not_sent"));
      continue;
    }
    if (part.body.length > prepared.configuredNoteBodyMaxChars || part.body.length > GHL_CONTACT_NOTE_TRANSMIT_CEILING) {
      notesStopped = true;
      noteError = "unsupported_note_size";
      noteDetail = `Note part ${part.part} exceeds the configured or provider ceiling.`;
      notes.push(noteReceipt(part.part, idempotencyKey, null, null, "not_sent"));
      continue;
    }
    const posted = await postOnce({
      fetchImpl,
      base: base.base,
      token: auth.token.trim(),
      timeoutMs,
      operation: "note",
      path: `/contacts/${encodeURIComponent(contactId)}/notes`,
      idempotencyKey,
      body: { title: part.title, body: part.body },
    });
    if (!posted.fetched) {
      notesStopped = true;
      noteError = "custom_fields_forbidden";
      noteDetail = posted.detail;
      notes.push(noteReceipt(part.part, idempotencyKey, null, null, "not_sent"));
      continue;
    }
    calls.push(posted.call);
    const noteId = posted.call.classification === "accepted" ? safeExternalId(extractNoteId(posted.json)) : null;
    if (posted.call.classification !== "accepted" || !noteId) {
      notesStopped = true;
      const failed = posted.call.classification === "failed";
      noteError = failed ? (posted.call.httpStatus === 422 ? "unsupported_note_size" : "note_failed") : "note_uncertain";
      noteDetail = posted.detail;
      notes.push(
        noteReceipt(part.part, idempotencyKey, null, posted.call.httpStatus, failed ? "failed" : "uncertain")
      );
      continue;
    }
    if (seenNoteIds.has(noteId)) {
      notesStopped = true;
      noteError = "note_partial";
      noteDetail = `Note part ${part.part} reused note id ${noteId}.`;
      notes.push(noteReceipt(part.part, idempotencyKey, null, posted.call.httpStatus, "failed"));
      continue;
    }
    seenNoteIds.add(noteId);
    notes.push(noteReceipt(part.part, idempotencyKey, noteId, posted.call.httpStatus, "accepted"));
  }

  const notePersisted =
    prepared.parts.length > 0 && notes.length === prepared.parts.length && notes.every((note) => note.noteId);
  if (!notePersisted) {
    return finish({
      prepared,
      calls,
      notes,
      contactId,
      error: noteError ?? "note_partial",
      detail: noteDetail,
      contactUpserted: true,
    });
  }

  const workflow = await postOnce({
    fetchImpl,
    base: base.base,
    token: auth.token.trim(),
    timeoutMs,
    operation: "workflow",
    path: `/contacts/${encodeURIComponent(contactId)}/workflow/${encodeURIComponent(prepared.workflowId)}`,
    idempotencyKey: prepared.keys.workflow,
    body: { locationId: prepared.locationId },
  });
  if (!workflow.fetched) {
    return finish({
      prepared,
      calls,
      notes,
      contactId,
      error: "workflow_enrollment_failed",
      detail: workflow.detail,
      contactUpserted: true,
      notePersisted: true,
    });
  }
  calls.push(workflow.call);
  if (workflow.call.classification !== "accepted") {
    const uncertain = workflow.call.classification !== "failed";
    return finish({
      prepared,
      calls,
      notes,
      contactId,
      error: uncertain ? "workflow_enrollment_uncertain" : "workflow_enrollment_failed",
      detail: workflow.detail,
      contactUpserted: true,
      notePersisted: true,
    });
  }

  return finish({
    prepared,
    calls,
    notes,
    contactId,
    error: null,
    detail: null,
    contactUpserted: true,
    notePersisted: true,
    workflowEnrolled: true,
  });
}

export function onboardingGhlTestOperationKeys(testRunId: string, partCount: number): OnboardingGhlTestIdempotencyKeys {
  return {
    contact: `onboarding-test:${testRunId}:ghl-contact`,
    notes: Array.from({ length: partCount }, (_, index) => `onboarding-test:${testRunId}:ghl-note:${index + 1}`),
    workflow: `onboarding-test:${testRunId}:ghl-workflow`,
  };
}

export function isReservedProductionDeliveryKey(key: string): boolean {
  return PRODUCTION_KEY.test(key);
}

function prepareDelivery(request: OnboardingGhlTestDeliveryRequest, env: NodeJS.ProcessEnv): PreparedDelivery | Refusal {
  if (env[ONBOARDING_GHL_TEST_GLOBAL_FLAG] !== "true") {
    return refusal("global_flag_disabled", `${ONBOARDING_GHL_TEST_GLOBAL_FLAG} must be exactly true.`);
  }
  if (env[ONBOARDING_GHL_TEST_ADAPTER_APPROVED_FLAG] !== "true") {
    return refusal(
      "live_adapter_not_approved",
      `${ONBOARDING_GHL_TEST_ADAPTER_APPROVED_FLAG} must be exactly true. Approval still cannot target a production host.`
    );
  }

  const clientAccountId = request.clientAccountId.trim();
  const testRunId = request.testRunId.trim();
  const sourceLeadEventId = request.sourceLeadEventId.trim();
  if (!clientAccountId || !SAFE_ID.test(testRunId) || !sourceLeadEventId) {
    return refusal("production_idempotency_guard", "The test run id cannot form an onboarding-test operation key.");
  }
  const authorization = request.authorization;
  if (
    !authorization ||
    authorization.scope !== "client" ||
    authorization.granted !== true ||
    typeof authorization.clientAccountId !== "string" ||
    typeof authorization.testRunId !== "string" ||
    authorization.clientAccountId.trim() !== clientAccountId ||
    authorization.testRunId.trim() !== testRunId
  ) {
    return refusal("client_authorization_required", "Client-specific authorization for this test run is required.");
  }
  if (request.acknowledgeDownstreamAutomation !== true) {
    return refusal(
      "downstream_automation_not_acknowledged",
      "Select Time Zone enrollment can start later GoHighLevel actions."
    );
  }

  const locationId = request.locationId.trim();
  const selectedLocationId = request.selectedLocationId.trim();
  if (!locationId || !selectedLocationId) {
    return refusal("ghl_destination_missing", "The selected GHL location is required.");
  }
  if (locationId !== selectedLocationId || !SAFE_ID.test(locationId)) {
    return refusal("ghl_destination_missing", "The selected location does not match the delivery location.");
  }

  const workflowId = request.workflowId.trim();
  if (!workflowId || !SAFE_ID.test(workflowId)) {
    return refusal("invalid_workflow_id", "The Select Time Zone workflow id is missing or not a location API id.");
  }
  if (request.workflowTriggerMode.trim() !== "direct_api") {
    return refusal("workflow_trigger_mode_invalid", "Enrollment is direct_api only. Tag triggers are not sent.");
  }
  const workflowError = classifyWorkflow(request, clientAccountId, workflowId);
  if (workflowError) return workflowError;

  if (request.event.sourceLeadEventId.trim() !== sourceLeadEventId) {
    return refusal("verified_test_identity_mismatch", "The stored event is not the requested source event.");
  }
  const identityError = matchIdentities(request);
  if (identityError) return identityError;

  const configured = resolveGhlNoteBodyMaxChars(env.SA360_GHL_NOTE_BODY_MAX_CHARS);
  if (configured > GHL_CONTACT_NOTE_TRANSMIT_CEILING) {
    return refusal(
      "unsupported_note_size",
      `SA360_GHL_NOTE_BODY_MAX_CHARS ${configured} is above the contact-note transmit ceiling ${GHL_CONTACT_NOTE_TRANSMIT_CEILING}. The Create Note schema publishes no higher maximum.`,
      null,
      configured
    );
  }

  const plan = buildOnboardingLeadNote({
    event: request.event,
    clientAccountId,
    testRunId,
    noteOverflow: request.noteOverflow ?? "refuse",
    maxChars: configured,
  });
  if (!plan.ok) {
    return refusal("client_account_mismatch", "The stored event belongs to another client.", null, configured);
  }
  if (plan.status === "note_too_long" || plan.error === "note_too_long") {
    return refusal(
      "note_too_long",
      "The note is longer than the configured maximum and overflow is refuse. Nothing was posted.",
      onboardingGhlTestOperationKeys(testRunId, 0),
      configured
    );
  }
  if (plan.parts.length === 0 || plan.parts.some((part) => part.body.length > configured)) {
    return refusal("unsupported_note_size", "The formatter did not produce a transmittable note part.", null, configured);
  }
  const ordered = [...plan.parts].sort((left, right) => left.part - right.part);
  const contiguous = ordered.every((part, index) => part.part === index + 1);
  if (!contiguous) {
    return refusal("note_partial", "Note parts are not a contiguous 1..N sequence.", null, configured);
  }
  const keys = onboardingGhlTestOperationKeys(testRunId, ordered.length);
  if (!keysAreOnboardingTestKeys(keys, testRunId)) {
    return refusal("production_idempotency_guard", "Refusing a key that is not an onboarding-test operation key.", keys, configured);
  }
  for (let index = 0; index < ordered.length; index += 1) {
    if (ordered[index]!.idempotencyKey !== keys.notes[index]) {
      return refusal(
        "production_idempotency_guard",
        "The note formatter returned a key this test adapter will not send.",
        keys,
        configured
      );
    }
  }

  const names = contactNames(request.event);
  const contactBody = onboardingContactUpsertBody(locationId, {
    firstName: names.firstName,
    lastName: names.lastName,
    email: blank(request.event.email),
    phone: blank(request.event.phone),
    state: blank(request.event.state),
    source: "sa360",
  });
  if (!contactBody || !contactBodyAllowed(contactBody)) {
    return refusal("custom_fields_forbidden", "The contact body is outside the location upsert contract.", keys, configured);
  }

  return {
    locationId,
    workflowId,
    contactBody,
    parts: ordered,
    keys,
    configuredNoteBodyMaxChars: configured,
  };
}

function classifyWorkflow(
  request: OnboardingGhlTestDeliveryRequest,
  clientAccountId: string,
  workflowId: string
): Refusal | null {
  const selection = validateSelectTimeZoneSelection({
    clientAccountId,
    destination: {
      clientAccountId,
      destinationWorkflowIdGhl: workflowId,
      workflowTriggerMode: "direct_api",
      deliveryEnabled: false,
      clientCutoverApproved: false,
    },
    workflows: request.discoveredWorkflows,
    discoveredWorkflowId: workflowId,
    discoveredName: request.workflowName,
  });
  if (selection.ok) {
    if (selection.workflowId !== workflowId || selection.patch.destinationWorkflowIdGhl !== workflowId) {
      return refusal("workflow_stale", "Discovery no longer returns the selected Select Time Zone workflow.");
    }
    if (selection.patch.workflowTriggerMode !== "direct_api") {
      return refusal("workflow_trigger_mode_invalid", "Selection did not stay on direct_api.");
    }
    return null;
  }
  if (selection.error === "workflow_ambiguous") {
    return refusal("workflow_ambiguous", "More than one Select Time Zone workflow is in the discovery snapshot.");
  }
  if (selection.error === "workflow_name_mismatch") {
    return refusal("workflow_stale", "The saved workflow name is no longer Select Time Zone.");
  }
  const current = request.discoveredWorkflows.filter((workflow) => workflowNameMatchesSelectTimeZone(workflow.name));
  if (current.length === 1 && current[0]?.id !== workflowId) {
    return refusal("workflow_stale", "Discovery now returns a different Select Time Zone workflow.");
  }
  if (request.discoveredWorkflows.some((workflow) => workflow.id === workflowId)) {
    return refusal("workflow_stale", "The saved workflow id is no longer the unique Select Time Zone match.");
  }
  return refusal("workflow_not_found", "Discovery has no Select Time Zone workflow for this location.");
}

function matchIdentities(request: OnboardingGhlTestDeliveryRequest): Refusal | null {
  if (!request.contact) {
    return refusal("verified_test_identity_mismatch", "The lead contact identity is required.");
  }
  const eventEmail = blank(request.event.email);
  const eventPhone = blank(request.event.phone);
  const contactEmail = blank(request.contact.email);
  const contactPhone = blank(request.contact.phone);
  if ((eventEmail?.toLowerCase() ?? null) !== (contactEmail?.toLowerCase() ?? null) || eventPhone !== contactPhone) {
    return refusal("verified_test_identity_mismatch", "The contact being sent is not the stored lead identity.");
  }
  const names = contactNames(request.event);
  const contactNamesGiven = contactNames(request.contact);
  if (names.firstName !== contactNamesGiven.firstName || names.lastName !== contactNamesGiven.lastName) {
    return refusal("verified_test_identity_mismatch", "The contact name being sent is not the stored lead name.");
  }
  if (blank(request.event.state) !== blank(request.contact.state)) {
    return refusal("verified_test_identity_mismatch", "The contact state being sent is not the stored lead state.");
  }
  const verifiedEmail = blank(request.verifiedTestIdentity?.email)?.toLowerCase() ?? null;
  const verifiedPhone = blank(request.verifiedTestIdentity?.phoneE164);
  const email = eventEmail?.toLowerCase() ?? null;
  const phone = eventPhone;
  const emailMatches = Boolean(verifiedEmail && email && verifiedEmail === email);
  const phoneMatches = Boolean(verifiedPhone && phone && verifiedPhone === phone);
  if (!emailMatches && !phoneMatches) {
    return refusal("verified_test_identity_mismatch", "The lead identity is not an approved test contact.");
  }
  return null;
}

function contactNames(contact: { fullName?: string | null; firstName?: string | null; lastName?: string | null }): {
  firstName: string | null;
  lastName: string | null;
} {
  const firstName = blank(contact.firstName);
  const lastName = blank(contact.lastName);
  if (firstName || lastName) return { firstName, lastName };
  return splitLeadName(contact.fullName);
}

function contactBodyAllowed(body: Record<string, unknown>): boolean {
  for (const key of Object.keys(body)) {
    if (!CONTACT_BODY_KEYS.has(key)) return false;
  }
  return !("customFields" in body) && !("customField" in body) && !("tags" in body);
}

function keysAreOnboardingTestKeys(keys: OnboardingGhlTestIdempotencyKeys, testRunId: string): boolean {
  const values = [keys.contact, keys.workflow, ...keys.notes];
  return values.every(
    (key) => key.startsWith(`onboarding-test:${testRunId}:`) && !isReservedProductionDeliveryKey(key)
  );
}

function resolveLoopbackBase(apiBaseUrl: string): { ok: true; base: string } | { ok: false; detail: string } {
  let url: URL;
  try {
    url = new URL(apiBaseUrl);
  } catch {
    return { ok: false, detail: "The location API base URL is not a URL." };
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    return { ok: false, detail: "Location API delivery requires an HTTPS origin with no user info." };
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    return { ok: false, detail: "The location API base URL must be an origin." };
  }
  if (REFUSED_HOSTS.has(host) || !isLoopbackHost(host)) {
    return {
      ok: false,
      detail: "Live GoHighLevel writes are not authorized. This adapter posts only to a loopback HTTPS mock.",
    };
  }
  return { ok: true, base: url.origin };
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

async function defaultResolveAuth(locationId: string): Promise<OnboardingGhlLocationAuth | null> {
  const auth = await resolveGhlBearerAuthForLocation(locationId);
  if (!auth?.token.trim()) return null;
  return { token: auth.token.trim() };
}

type PostArgs = {
  fetchImpl: typeof fetch;
  base: string;
  token: string;
  timeoutMs: number;
  operation: OnboardingGhlTestCallReceipt["operation"];
  path: string;
  idempotencyKey: string;
  body: Record<string, unknown>;
};

async function postOnce(
  args: PostArgs
): Promise<{ fetched: boolean; call: OnboardingGhlTestCallReceipt; json: unknown; detail: string | null }> {
  if (!allowedPath(args.operation, args.path) || !operationBodyAllowed(args.operation, args.body)) {
    return {
      fetched: false,
      json: null,
      detail: "The operation is outside the location API contract and was not sent.",
      call: {
        operation: args.operation,
        method: "POST",
        path: args.path,
        idempotencyKey: args.idempotencyKey,
        httpStatus: null,
        classification: "failed",
        externalId: null,
        attempts: 1,
      },
    };
  }
  const url = `${args.base}${args.path}`;
  try {
    const response = await args.fetchImpl(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${args.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Version: ONBOARDING_GHL_LOCATION_API_VERSION,
        "Idempotency-Key": args.idempotencyKey,
      },
      body: JSON.stringify(args.body),
      signal: AbortSignal.timeout(args.timeoutMs),
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const classification = classifyHttp(response.status);
    const externalId =
      classification === "accepted"
        ? args.operation === "contact"
          ? safeExternalId(extractContactIdFromGhlResponse(json))
          : args.operation === "note"
            ? safeExternalId(extractNoteId(json))
            : null
        : null;
    return {
      fetched: true,
      json,
      detail: classification === "accepted" ? null : parseGhlApiErrorSummary(text, json),
      call: {
        operation: args.operation,
        method: "POST",
        path: args.path,
        idempotencyKey: args.idempotencyKey,
        httpStatus: response.status,
        classification,
        externalId,
        attempts: 1,
      },
    };
  } catch (error) {
    return {
      fetched: true,
      json: null,
      detail: error instanceof Error ? error.name : "transport_error",
      call: {
        operation: args.operation,
        method: "POST",
        path: args.path,
        idempotencyKey: args.idempotencyKey,
        httpStatus: null,
        classification: "uncertain",
        externalId: null,
        attempts: 1,
      },
    };
  }
}

function allowedPath(operation: PostArgs["operation"], path: string): boolean {
  if (operation === "contact") return path === "/contacts/upsert";
  if (operation === "note") return /^\/contacts\/[A-Za-z0-9_-]+\/notes$/.test(path);
  return /^\/contacts\/[A-Za-z0-9_-]+\/workflow\/[A-Za-z0-9_-]+$/.test(path);
}

function operationBodyAllowed(operation: PostArgs["operation"], body: Record<string, unknown>): boolean {
  const keys = Object.keys(body);
  if (keys.some((key) => key === "customFields" || key === "customField" || key === "tags")) return false;
  if (operation === "contact") return keys.every((key) => CONTACT_BODY_KEYS.has(key));
  if (operation === "note") return keys.length === 2 && keys.includes("title") && keys.includes("body");
  return keys.length === 1 && keys[0] === "locationId" && typeof body.locationId === "string";
}

function classifyHttp(status: number): Exclude<OnboardingGhlCallClassification, "not_sent"> {
  if (status >= 200 && status < 300) return "accepted";
  if (status === 408 || status === 429 || status >= 500 || status === 0) return "uncertain";
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

function safeExternalId(value: string | null): string | null {
  if (!value || !SAFE_ID.test(value)) return null;
  return value;
}

function noteReceipt(
  part: number,
  idempotencyKey: string,
  noteId: string | null,
  httpStatus: number | null,
  classification: OnboardingGhlCallClassification
): OnboardingGhlTestNoteReceipt {
  return {
    part,
    idempotencyKey,
    noteId,
    httpStatus,
    classification,
    attempts: classification === "not_sent" ? 0 : 1,
  };
}

function notSentNotes(parts: readonly OnboardingLeadNotePart[], keys: readonly string[]): OnboardingGhlTestNoteReceipt[] {
  return parts.map((part, index) => noteReceipt(part.part, keys[index] ?? "", null, null, "not_sent"));
}

function refusal(
  error: string,
  detail: string,
  keys: OnboardingGhlTestIdempotencyKeys | null = null,
  configuredNoteBodyMaxChars: number | null = null,
  notes: OnboardingGhlTestNoteReceipt[] = []
): Refusal {
  return { error, detail, keys, configuredNoteBodyMaxChars, notes };
}

function refused(input: Refusal): OnboardingGhlTestDeliveryReceipt {
  return {
    ok: false,
    posted: false,
    retried: false,
    externalCallExecuted: false,
    error: input.error,
    detail: input.detail,
    evidence: evidence({
      http_accepted: false,
      contact_upserted: false,
      note_persisted: false,
      workflow_enrolled: false,
    }),
    contactId: null,
    workflowId: null,
    idempotencyKeys: input.keys,
    notes: input.notes,
    calls: [],
    configuredNoteBodyMaxChars: input.configuredNoteBodyMaxChars,
    providerNoteBodyCeiling: GHL_CONTACT_NOTE_TRANSMIT_CEILING,
  };
}

function finish(input: {
  prepared: PreparedDelivery;
  calls: OnboardingGhlTestCallReceipt[];
  notes: OnboardingGhlTestNoteReceipt[];
  contactId: string | null;
  error: string | null;
  detail: string | null;
  contactUpserted: boolean;
  notePersisted?: boolean;
  workflowEnrolled?: boolean;
}): OnboardingGhlTestDeliveryReceipt {
  const httpAccepted = input.calls.length > 0 && input.calls.every((call) => call.classification === "accepted");
  const notePersisted = input.notePersisted === true;
  const workflowEnrolled = input.workflowEnrolled === true;
  const receipt: OnboardingGhlTestDeliveryReceipt = {
    ok: input.error === null && input.contactUpserted && notePersisted && workflowEnrolled && httpAccepted,
    posted: notePersisted,
    retried: false,
    externalCallExecuted: input.calls.length > 0,
    error: input.error,
    detail: input.detail,
    evidence: evidence({
      http_accepted: httpAccepted,
      contact_upserted: input.contactUpserted,
      note_persisted: notePersisted,
      workflow_enrolled: workflowEnrolled,
    }),
    contactId: input.contactId,
    workflowId: workflowEnrolled ? input.prepared.workflowId : null,
    idempotencyKeys: input.prepared.keys,
    notes: input.notes,
    calls: input.calls,
    configuredNoteBodyMaxChars: input.prepared.configuredNoteBodyMaxChars,
    providerNoteBodyCeiling: GHL_CONTACT_NOTE_TRANSMIT_CEILING,
  };
  return receipt;
}

function evidence(input: {
  http_accepted: boolean;
  contact_upserted: boolean;
  note_persisted: boolean;
  workflow_enrolled: boolean;
}): OnboardingGhlTestEvidence {
  return {
    http_accepted: input.http_accepted,
    contact_upserted: input.contact_upserted,
    note_persisted: input.note_persisted,
    workflow_enrolled: input.workflow_enrolled,
    downstream_executed: false,
  };
}

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}
