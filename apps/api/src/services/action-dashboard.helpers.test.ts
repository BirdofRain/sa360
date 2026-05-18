import test from "node:test";
import assert from "node:assert/strict";
import type { InboundContactIndex } from "@prisma/client";
import { InboundContactSourceOrigin } from "@prisma/client";
import {
  buildActionDashboardFromData,
  isExcludedContact,
  scorePriorityContact,
  type ActionDashboardRawData,
  type LifecycleRowLite,
} from "./action-dashboard.helpers.js";
import { resolveActionDashboardScope } from "./action-dashboard-scope.js";

function makeContact(overrides: Partial<InboundContactIndex> = {}): InboundContactIndex {
  const now = new Date("2026-05-18T15:00:00.000Z");
  return {
    id: "idx_1",
    clientAccountId: "client_a",
    subaccountIdGhl: "loc_1",
    phoneE164: "+15550001111",
    leadUid: "lead_1",
    contactIdGhl: "ghl_1",
    firstName: "Ada",
    lastName: "Lovelace",
    displayName: "Ada Lovelace",
    email: null,
    state: null,
    assignedAgentId: null,
    assignedAgentName: "Agent A",
    lifecycleStage: "NEW",
    appointmentStatus: null,
    policyStatus: null,
    leadType: null,
    sourceOrigin: InboundContactSourceOrigin.lifecycle_webhook,
    clientStatus: null,
    lastSeenAt: now,
    createdAt: new Date(now.getTime() - 10 * 60_000),
    updatedAt: now,
    ...overrides,
  };
}

test("isExcludedContact rejects DEAD and DNC stages", () => {
  assert.equal(isExcludedContact(makeContact({ lifecycleStage: "DEAD" }), null), true);
  assert.equal(isExcludedContact(makeContact({ lifecycleStage: "DNC" }), null), true);
  assert.equal(isExcludedContact(makeContact({ lifecycleStage: "NEW" }), null), false);
});

test("scorePriorityContact ranks new lead above stale activity", () => {
  const now = new Date("2026-05-18T15:00:00.000Z");
  const newLead = scorePriorityContact({
    contact: makeContact({ createdAt: new Date(now.getTime() - 5 * 60_000) }),
    events: [],
    outboundBooked: [],
    now,
  });
  const stale = scorePriorityContact({
    contact: makeContact({
      contactIdGhl: "ghl_2",
      phoneE164: "+15550002222",
      createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60_000),
      lastSeenAt: new Date(now.getTime() - 2 * 60 * 60_000),
    }),
    events: [],
    outboundBooked: [],
    now,
  });
  assert.ok(newLead.score > stale.score);
});

test("buildActionDashboardFromData sorts priority leads by score", () => {
  const now = new Date("2026-05-18T15:00:00.000Z");
  const scope = resolveActionDashboardScope({
    clientAccountId: "client_a",
    locationId: "loc_1",
    now,
  });

  const hot = makeContact({
    contactIdGhl: "ghl_hot",
    phoneE164: "+15550001111",
    lifecycleStage: "APPOINTMENT_SET",
    appointmentStatus: "Confirmed",
    createdAt: new Date(now.getTime() - 2 * 60_000),
  });
  const cold = makeContact({
    contactIdGhl: "ghl_cold",
    phoneE164: "+15550002222",
    lifecycleStage: "NEW",
    createdAt: new Date(now.getTime() - 10 * 24 * 60 * 60_000),
    lastSeenAt: new Date(now.getTime() - 3 * 24 * 60 * 60_000),
  });

  const appointmentEvent: LifecycleRowLite = {
    id: "ev1",
    leadUid: "lead_1",
    contactIdGhl: "ghl_hot",
    eventNameInternal: "appointment_set",
    receivedAt: now,
    payloadJson: {
      contact: { contact_id_ghl: "ghl_hot", lead_uid: "lead_1", phone_e164: "+15550001111" },
      state: { lifecycle_stage: "APPOINTMENT_SET", ai_status: "synthflow_booked" },
    },
  };

  const data: ActionDashboardRawData = {
    scope,
    clientName: "Test Client",
    contacts: [cold, hot],
    lifecycleLookback: [appointmentEvent],
    lifecycleToday: [appointmentEvent],
    synthflowInbound: [],
    synthflowOutbound: [],
    lastWebhookSuccessAt: now,
    hasLifecycleRows: true,
    hasSynthflowInbound: false,
    hasSynthflowOutbound: false,
    hasWebhookSuccess: true,
    hasContacts: true,
  };

  const res = buildActionDashboardFromData(data);
  assert.ok(res.priorityLeads.length >= 1);
  assert.equal(res.priorityLeads[0].contactIdGhl, "ghl_hot");
  assert.ok(res.priorityLeads[0].priorityScore >= 80);
});
