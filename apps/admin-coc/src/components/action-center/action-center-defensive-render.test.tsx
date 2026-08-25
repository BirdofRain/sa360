import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";

import { mapActionDashboardToUi } from "@/lib/action-center/map-action-dashboard.ts";
import type { AdminActionDashboardToday } from "@/lib/admin-api/types.ts";

import { ActionCenterAiFeed } from "./action-center-ai-feed.tsx";
import { ActionCenterGhlCard } from "./action-center-ghl-card.tsx";
import { ActionCenterKpiRow } from "./action-center-kpi-row.tsx";
import { ActionCenterPriorityList } from "./action-center-priority-list.tsx";

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
