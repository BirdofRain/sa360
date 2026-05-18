import test from "node:test";
import assert from "node:assert/strict";
import { enrichLifecyclePayloadForIngest } from "../lib/lifecycle-event-enrich.js";
import { actionCenterActionCodeSchema } from "../schemas/action-dashboard-action.schema.js";
import {
  ACTION_CODE_TO_LIFECYCLE_EVENTS,
  buildLifecyclePayloadsForAction,
  listEventNamesForActionCode,
} from "./action-dashboard-action-map.js";
import { isExcludedContact } from "./action-dashboard.helpers.js";
import type { InboundContactIndex } from "@prisma/client";
import { InboundContactSourceOrigin } from "@prisma/client";

const baseBody = {
  clientAccountId: "client_a",
  locationId: "loc_1",
  contactIdGhl: "ghl_contact_1",
  phoneE164: "+15551234567",
} as const;

test("each actionCode maps to expected lifecycle event names", () => {
  const expected: Record<string, string[]> = {
    CALL_ATTEMPT: ["call_attempt_logged"],
    CALL_CONNECTED: ["call_connected"],
    NO_ANSWER: ["call_no_answer"],
    BOOKED: ["disposition_logged", "appointment_set"],
    FOLLOW_UP: ["disposition_logged", "follow_up_needed"],
    QUOTE_GIVEN: ["disposition_logged", "quote_given"],
    SOLD: ["disposition_logged", "sold"],
    NOT_INTERESTED: ["disposition_logged"],
    BAD_NUMBER: ["disposition_logged", "bad_number"],
    DNC: ["disposition_logged", "dnc"],
    DEAD_LEAD: ["disposition_logged", "dead_lead"],
  };

  for (const code of actionCenterActionCodeSchema.options) {
    assert.deepEqual(listEventNamesForActionCode(code), expected[code]);
    assert.equal(ACTION_CODE_TO_LIFECYCLE_EVENTS[code].length, expected[code].length);
  }
});

test("DNC action enriches to excluded lifecycle stage on index model", () => {
  const payloads = buildLifecyclePayloadsForAction({
    body: { ...baseBody, actionCode: "DNC", notes: "requested stop" },
    actionId: "act_test_1",
  });
  const last = enrichLifecyclePayloadForIngest(payloads[payloads.length - 1]!);
  assert.equal(last.state.lifecycle_stage, "DNC");

  const contact = {
    id: "x",
    clientAccountId: "client_a",
    subaccountIdGhl: "loc_1",
    phoneE164: "+15551234567",
    leadUid: "lead_1",
    contactIdGhl: "ghl_contact_1",
    firstName: null,
    lastName: null,
    displayName: "Test",
    email: null,
    state: null,
    assignedAgentId: null,
    assignedAgentName: null,
    lifecycleStage: "DNC",
    appointmentStatus: null,
    policyStatus: null,
    leadType: null,
    sourceOrigin: InboundContactSourceOrigin.lifecycle_webhook,
    clientStatus: null,
    lastSeenAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } satisfies InboundContactIndex;

  assert.equal(isExcludedContact(contact, last), true);
});

test("SOLD accepts optional policy payload on lifecycle events", () => {
  const payloads = buildLifecyclePayloadsForAction({
    body: {
      ...baseBody,
      actionCode: "SOLD",
      policy: {
        policyStatus: "Issued",
        annualPremium: 1200,
        carrier: "Acme",
        productType: "Term",
      },
    },
    actionId: "act_sold_1",
  });
  const soldEvent = payloads.find((p) => p.event.event_name_internal === "sold");
  assert.ok(soldEvent?.policy);
  assert.equal(soldEvent.policy?.carrier, "Acme");
  assert.equal(soldEvent.policy?.premium_estimate, 1200);
});
