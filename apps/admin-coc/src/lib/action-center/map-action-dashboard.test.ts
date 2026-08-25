import test from "node:test";
import assert from "node:assert/strict";
import { mapActionDashboardToUi } from "./map-action-dashboard.ts";
import type { AdminActionDashboardToday } from "../admin-api/types.ts";

const sampleApi: AdminActionDashboardToday = {
  ok: true,
  generatedAt: "2026-05-18T12:00:00.000Z",
  subaccount: {
    clientAccountId: "client_test",
    locationId: "loc_1",
    locationName: "Test Location",
    agentDisplayName: "Agent One",
    connectionStatus: "connected",
    lastSyncAt: "2026-05-18T11:00:00.000Z",
    syncMessage: "ok",
  },
  summary: {
    aiAppointmentsToday: 1,
    hotActionsWaiting: 2,
    callsLoggedToday: 3,
    revenueSignalsToday: 4,
  },
  priorityLeads: [
    {
      rank: 1,
      priorityScore: 90,
      contactIdGhl: "ghl_1",
      leadUid: null,
      displayName: "A",
      phoneE164: "+15550001111",
      reason: "test",
      reasonCode: "hot_lead",
      dueBy: null,
      estimatedPremium: null,
      lifecycleStage: "AI_ENGAGED",
      lastTouchAt: null,
      workspace: {
        nextAction: "Call",
        appointmentStatus: null,
        policyStatus: null,
        ownerName: "Agent One",
        lastActivityAt: "2026-05-18T10:00:00.000Z",
      },
    },
    {
      rank: 2,
      priorityScore: 80,
      contactIdGhl: "ghl_2",
      leadUid: null,
      displayName: "B",
      phoneE164: "+15550002222",
      reason: "test",
      reasonCode: "callback_due",
      dueBy: null,
      estimatedPremium: null,
      lifecycleStage: null,
      lastTouchAt: null,
      workspace: null,
    },
  ],
  aiActivity: [
    {
      id: "f1",
      at: "2026-05-18T09:00:00.000Z",
      kind: "voice",
      title: "Call",
      detail: null,
      contactIdGhl: "ghl_1",
      displayName: "A",
    },
  ],
  setupWarnings: ["seeded"],
};

test("mapActionDashboardToUi maps API contract to UI dashboard shape", () => {
  const mapped = mapActionDashboardToUi(sampleApi);
  assert.equal(mapped.clientAccountId, "client_test");
  assert.equal(mapped.ghlConnection.status, "connected");
  assert.equal(mapped.priorityCalls.length, 2);
  assert.equal(mapped.activeLeads.length, 1);
  assert.equal(mapped.activeLeads[0].nextAction, "Call");
  assert.equal(mapped.aiActivityFeed.length, 1);
  assert.deepEqual(mapped.setupWarnings, ["seeded"]);
  assert.equal(mapped.sections.priorityCalls, "ok");
  assert.equal(mapped.sections.aiActivity, "ok");
});

test("mapActionDashboardToUi treats missing priorityLeads as unavailable, not empty", () => {
  const mapped = mapActionDashboardToUi({
    ...sampleApi,
    priorityLeads: undefined,
  } as never);
  assert.equal(mapped.priorityCalls.length, 0);
  assert.equal(mapped.sections.priorityCalls, "unavailable");
  assert.equal(mapped.sections.activeLeads, "unavailable");
  assert.equal(mapped.sections.aiActivity, "ok");
});

test("mapActionDashboardToUi treats null priorityLeads as unavailable", () => {
  const mapped = mapActionDashboardToUi({
    ...sampleApi,
    priorityLeads: null,
  } as never);
  assert.equal(mapped.sections.priorityCalls, "unavailable");
});

test("mapActionDashboardToUi treats an empty priorityLeads array as empty", () => {
  const mapped = mapActionDashboardToUi({
    ...sampleApi,
    priorityLeads: [],
  });
  assert.equal(mapped.priorityCalls.length, 0);
  assert.equal(mapped.sections.priorityCalls, "empty");
});

test("mapActionDashboardToUi keeps neighboring data when summary is missing", () => {
  const mapped = mapActionDashboardToUi({
    ...sampleApi,
    summary: undefined,
  } as never);
  assert.equal(mapped.sections.kpis, "unavailable");
  assert.equal(mapped.kpis.aiAppointmentsToday, null);
  assert.equal(mapped.priorityCalls.length, 2);
  assert.equal(mapped.ghlConnection.status, "connected");
});

test("mapActionDashboardToUi marks unknown connection status without throwing", () => {
  const mapped = mapActionDashboardToUi({
    ...sampleApi,
    subaccount: { ...sampleApi.subaccount, connectionStatus: "maintenance" as never },
  });
  assert.equal(mapped.ghlConnection.status, "unknown");
  assert.equal(mapped.ghlConnection.rawStatus, "maintenance");
  assert.equal(mapped.priorityCalls.length, 2);
});
