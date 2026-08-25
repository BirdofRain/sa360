import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";

import { mapActionDashboardToUi } from "@/lib/action-center/map-action-dashboard.ts";
import type { AdminActionDashboardToday } from "@/lib/admin-api/types.ts";

import { ActionCenterAiFeed } from "./action-center-ai-feed.tsx";
import { ActionCenterGhlCard } from "./action-center-ghl-card.tsx";
import { ActionCenterKpiRow } from "./action-center-kpi-row.tsx";
import { ActionCenterPriorityList } from "./action-center-priority-list.tsx";
import { ActionCenterSetupWarnings } from "./action-center-setup-warnings.tsx";

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
  priorityLeads: [],
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
  setupWarnings: [],
};

test("healthy payload keeps operator-visible values and does not show degraded banners", () => {
  const mapped = mapActionDashboardToUi({
    ...sampleApi,
    summary: {
      aiAppointmentsToday: 0,
      hotActionsWaiting: 0,
      callsLoggedToday: 0,
      revenueSignalsToday: 0,
    },
    priorityLeads: [
      {
        rank: 1,
        priorityScore: 90,
        contactIdGhl: "ghl_1",
        leadUid: null,
        displayName: "Alex",
        phoneE164: "+15550001111",
        reason: "hot",
        reasonCode: "hot_lead",
        dueBy: null,
        estimatedPremium: null,
        lifecycleStage: null,
        lastTouchAt: null,
        workspace: null,
      },
    ],
    setupWarnings: ["seeded"],
  });

  render(
    <div>
      <ActionCenterGhlCard
        connection={mapped.ghlConnection}
        availability={mapped.sections.ghlConnection}
      />
      <ActionCenterKpiRow kpis={mapped.kpis} availability={mapped.sections.kpis} />
      <ActionCenterPriorityList
        items={mapped.priorityCalls}
        availability={mapped.sections.priorityCalls}
      />
      <ActionCenterAiFeed items={mapped.aiActivityFeed} availability={mapped.sections.aiActivity} />
      <ActionCenterSetupWarnings
        warnings={mapped.setupWarnings}
        availability={mapped.sections.setupWarnings}
      />
    </div>
  );

  assert.ok(screen.getByText("Connected"));
  assert.ok(screen.getByText("Alex"));
  assert.ok(screen.getByText("Hot lead"));
  assert.ok(screen.getByText("Call"));
  assert.ok(screen.getByText("seeded"));
  assert.equal(screen.getAllByText("0").length, 4);
  assert.equal(screen.queryByText("KPI summary unavailable"), null);
  assert.equal(screen.queryByText("Priority list unavailable"), null);
  assert.equal(screen.queryByText("No calls queued"), null);
  assert.equal(screen.queryByText("AI activity unavailable"), null);
  assert.equal(screen.queryByText("Setup notes unavailable"), null);
  cleanup();
});

test("partial payload keeps neighboring valid sections renderable", () => {
  const mapped = mapActionDashboardToUi({
    ...sampleApi,
    priorityLeads: undefined,
    summary: undefined,
  } as never);

  render(
    <div>
      <ActionCenterGhlCard
        connection={mapped.ghlConnection}
        availability={mapped.sections.ghlConnection}
      />
      <ActionCenterKpiRow kpis={mapped.kpis} availability={mapped.sections.kpis} />
      <ActionCenterPriorityList
        items={mapped.priorityCalls}
        availability={mapped.sections.priorityCalls}
      />
      <ActionCenterAiFeed items={mapped.aiActivityFeed} availability={mapped.sections.aiActivity} />
    </div>
  );

  assert.ok(screen.getByText("Test Location"));
  assert.ok(screen.getByText("KPI summary unavailable"));
  assert.ok(screen.getByText("Priority list unavailable"));
  assert.ok(screen.getByText("Call"));
  assert.equal(screen.queryByText("No calls queued"), null);
  cleanup();
});
