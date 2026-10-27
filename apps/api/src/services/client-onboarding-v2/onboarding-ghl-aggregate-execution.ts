/**
 * One GHL execution owner for a captured onboarding test.
 *
 * Agent C's orchestrator persists attempts and keys. Agent H's adapter already
 * performs contact upsert, every note part, and workflow enrollment inside
 * `deliver()`, and it stops when a POST outcome is unknown. Calling `deliver()`
 * from `upsertContact`, `createNote`, and `enrollWorkflow` would send each
 * operation three times.
 *
 * Option A (split the adapter into step methods) was not selected. It would
 * either duplicate the tested stop-on-uncertain sequence or leave `deliver()`
 * as a second owner beside the orchestrator. This module is option B: the
 * orchestrator calls the aggregate adapter once, then projects that receipt
 * onto the existing attempt rows. The three-step port remains for unit fakes
 * and is not invoked on this path.
 *
 * `downstream_executed` is never taken from HTTP 2xx.
 */

import type { OnboardingStoredLeadEvent } from "../ghl-delivery-adapter/onboarding-lead-note.js";
import type {
  OnboardingGhlTestDeliveryReceipt,
  OnboardingGhlTestDeliveryRequest,
} from "./onboarding-ghl-test-adapter.js";
import type {
  AttemptStatus,
  CapturedTestPlan,
  CapturedTestRequest,
  CapturedTestWorld,
  StoredAttempt,
} from "./captured-test-delivery.js";

export function buildOnboardingGhlAggregateRequest(
  plan: CapturedTestPlan,
  input: CapturedTestRequest,
  world: CapturedTestWorld
): OnboardingGhlTestDeliveryRequest | null {
  const ghl = plan.ghl;
  const lead = world.storedLead;
  if (!ghl || !lead) return null;
  const workflowName = world.ghl?.workflowName?.trim() ?? "";
  if (!workflowName) return null;
  const identity = matchingIdentity(world, lead);
  return {
    clientAccountId: plan.clientAccountId,
    testRunId: plan.testRunId,
    sourceLeadEventId: plan.sourceLeadEventId ?? lead.sourceLeadEventId,
    authorization: {
      scope: "client",
      clientAccountId: plan.clientAccountId,
      testRunId: plan.testRunId,
      granted: true,
    },
    verifiedTestIdentity: {
      email: identity?.email ?? null,
      phoneE164: identity?.phoneE164 ?? null,
    },
    contact: {
      fullName: lead.fullName ?? null,
      firstName: lead.firstName ?? null,
      lastName: lead.lastName ?? null,
      email: lead.email ?? null,
      phone: lead.phone ?? null,
      state: lead.state ?? null,
    },
    event: lead as OnboardingStoredLeadEvent,
    locationId: ghl.locationId,
    selectedLocationId: ghl.locationId,
    workflowId: ghl.workflowId,
    workflowName,
    workflowTriggerMode: world.ghl?.workflowTriggerMode?.trim() || "direct_api",
    discoveredWorkflows: world.ghl?.discoveredWorkflows ?? [],
    acknowledgeDownstreamAutomation: input.acknowledgeDownstreamAutomation === true,
    noteOverflow: input.noteOverflow ?? "refuse",
  };
}

export function projectOnboardingGhlReceipt(
  plan: CapturedTestPlan,
  receipt: OnboardingGhlTestDeliveryReceipt
): StoredAttempt[] {
  const contactKey = receipt.idempotencyKeys?.contact ?? plan.ghl?.contact.idempotencyKey ?? "";
  const workflowKey = receipt.idempotencyKeys?.workflow ?? plan.ghl?.workflowIdempotencyKey ?? "";
  const contactCall = receipt.calls.find((call) => call.operation === "contact") ?? null;
  const workflowCall = receipt.calls.find((call) => call.operation === "workflow") ?? null;
  const contactPosted = contactCall !== null;
  const contactStatus = contactPosted ? statusForCall(contactCall.classification, contactCall.externalId) : "failed";
  const attempts: StoredAttempt[] = [
    attempt({
      plan,
      suffix: "ghl-contact",
      idempotencyKey: contactKey,
      status: contactStatus,
      externalCallExecuted: contactPosted,
      proves:
        contactStatus === "succeeded"
          ? ["contact_upsert_accepted", "contact_upserted", "http_accepted"]
          : [],
      detail: contactPosted ? contactCall.externalId : receipt.error,
    }),
  ];

  const noteRows = receipt.notes.length > 0 ? receipt.notes : fallbackNotes(plan);
  let blocked = contactStatus !== "succeeded";
  for (const note of noteRows) {
    const posted = note.classification !== "not_sent";
    const status: AttemptStatus = blocked && !posted ? "not_executed" : statusForNote(note.classification, note.noteId);
    if (status !== "succeeded") blocked = true;
    attempts.push(
      attempt({
        plan,
        suffix: `ghl-note:${note.part}`,
        idempotencyKey: note.idempotencyKey,
        status,
        externalCallExecuted: posted,
        proves: status === "succeeded" && note.noteId ? ["note_persisted"] : [],
        detail: posted ? note.noteId : blocked ? "not sent after an earlier GHL outcome" : receipt.error,
      })
    );
  }

  const workflowPosted = workflowCall !== null;
  const workflowStatus: AttemptStatus = workflowPosted
    ? statusForCall(workflowCall.classification, workflowCall.classification === "accepted" ? plan.ghl?.workflowId ?? "enrolled" : null)
    : "not_executed";
  attempts.push(
    attempt({
      plan,
      suffix: "ghl-workflow",
      idempotencyKey: workflowKey,
      status: workflowStatus,
      externalCallExecuted: workflowPosted,
      proves: workflowStatus === "succeeded" ? ["workflow_enrolled", "http_accepted"] : [],
      detail: workflowPosted ? null : blocked ? "not sent after an earlier GHL outcome" : receipt.error,
    })
  );
  return attempts.filter((item) => item.idempotencyKey.length > 0);
}

function matchingIdentity(
  world: CapturedTestWorld,
  lead: NonNullable<CapturedTestWorld["storedLead"]>
) {
  const email = lead.email?.trim().toLowerCase() ?? "";
  const phone = lead.phone?.trim() ?? "";
  return (
    world.identities.find((identity) => {
      const rowEmail = identity.email?.trim().toLowerCase() ?? "";
      const rowPhone = identity.phoneE164?.trim() ?? "";
      return (rowEmail && email && rowEmail === email) || (rowPhone && phone && rowPhone === phone);
    }) ?? null
  );
}

function fallbackNotes(plan: CapturedTestPlan): Array<{
  part: number;
  idempotencyKey: string;
  noteId: string | null;
  classification: "not_sent";
}> {
  const parts = plan.note?.parts ?? [];
  if (parts.length === 0) return [];
  return parts.map((part) => ({
    part: part.part,
    idempotencyKey: part.idempotencyKey,
    noteId: null,
    classification: "not_sent" as const,
  }));
}

function statusForCall(
  classification: "accepted" | "failed" | "uncertain",
  externalId: string | null
): AttemptStatus {
  if (classification === "uncertain") return "uncertain";
  if (classification === "failed") return "failed";
  return externalId ? "succeeded" : "uncertain";
}

function statusForNote(
  classification: "accepted" | "failed" | "uncertain" | "not_sent",
  noteId: string | null
): AttemptStatus {
  if (classification === "not_sent") return "not_executed";
  if (classification === "uncertain") return "uncertain";
  if (classification === "failed") return "failed";
  return noteId ? "succeeded" : "uncertain";
}

function attempt(input: {
  plan: CapturedTestPlan;
  suffix: string;
  idempotencyKey: string;
  status: AttemptStatus;
  externalCallExecuted: boolean;
  proves: string[];
  detail: string | null;
}): StoredAttempt {
  return {
    id: `${input.plan.testRunId}:${input.suffix}`,
    destination: "ghl_location_api",
    idempotencyKey: input.idempotencyKey,
    status: input.status,
    proves: input.proves,
    doesNotProve: ["downstream_executed", "source_delivery", "workflow_finished"],
    externalCallExecuted: input.externalCallExecuted,
    downstreamExecuted: false,
    detail: input.detail,
  };
}
