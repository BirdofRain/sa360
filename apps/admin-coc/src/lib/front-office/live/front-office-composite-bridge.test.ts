import test from "node:test";
import assert from "node:assert/strict";
import type { CompositeSummaryResponse, CompositeTrustResponse } from "@/lib/front-office-composite/types";
import {
  isCompositeSummaryUsable,
  isCompositeTrustUsable,
  mapCompositeSummaryToDashboard,
  mapCompositeTrustToFrontOffice,
} from "./front-office-composite-bridge";
import { getMockDashboard } from "../mock/dashboard";

const trustComposite: CompositeTrustResponse = {
  ok: true,
  generatedAt: "2026-06-01T10:00:00.000Z",
  dataSource: "partial_live",
  cards: [
    {
      key: "ghl_connection",
      title: "GHL Connection",
      status: "verified",
      source: "live",
      summary: "Connected",
      lastCheckedAt: "2026-06-01T10:00:00.000Z",
      warnings: [],
      details: [{ id: "1", label: "Loc", status: "verified", detail: "OK" }],
    },
  ],
};

test("mapCompositeTrustToFrontOffice maps title to label", () => {
  const mapped = mapCompositeTrustToFrontOffice(trustComposite);
  assert.equal(mapped.cards[0]?.label, "GHL Connection");
  assert.equal(mapped.dataSource, "partial_live");
});

test("isCompositeTrustUsable detects live cards", () => {
  assert.equal(isCompositeTrustUsable(trustComposite.cards), true);
  assert.equal(
    isCompositeTrustUsable([{ ...trustComposite.cards[0]!, source: "mock" }]),
    false
  );
});

test("empty composite summary maps to live empty dashboard state", () => {
  const summary: CompositeSummaryResponse = {
    ok: true,
    generatedAt: "2026-06-01T10:00:00.000Z",
    dataSource: "live",
    kpis: {
      leadsReceived: 0,
      leadsMatched: 0,
      leadsDelivered: 0,
      deliveryFailures: 0,
      appointmentsSet: 0,
      soldLogged: 0,
      trustWarnings: 0,
      latestLeadEvent: null,
    },
    urgentTasks: [],
    recentLeadDelivery: [],
    trustSummary: { status: "verified", warningCount: 0, cardsNeedingAttention: [] },
  };
  const mapped = mapCompositeSummaryToDashboard(summary, getMockDashboard("admin"));
  assert.deepEqual(mapped.recentDeliveries, []);
  assert.equal(mapped.kpis.find((k) => k.key === "leadsDelivered")?.value, 0);
});

test("mock-only trust composite is not usable for live bridge", () => {
  assert.equal(
    isCompositeTrustUsable([
      {
        key: "ghl_connection",
        title: "GHL Connection",
        status: "mock",
        source: "mock",
        summary: "Preview",
        lastCheckedAt: null,
        warnings: [],
        details: [],
      },
    ]),
    false
  );
});

test("mapCompositeSummaryToDashboard maps operational KPIs", () => {
  const summary: CompositeSummaryResponse = {
    ok: true,
    generatedAt: "2026-06-01T10:00:00.000Z",
    dataSource: "partial_live",
    kpis: {
      leadsReceived: 10,
      leadsMatched: 8,
      leadsDelivered: 5,
      deliveryFailures: 1,
      appointmentsSet: 3,
      soldLogged: 2,
      trustWarnings: 2,
      latestLeadEvent: "2026-06-01T09:00:00.000Z",
    },
    urgentTasks: [],
    recentLeadDelivery: [],
    trustSummary: { status: "warning", warningCount: 2, cardsNeedingAttention: [] },
  };
  const mapped = mapCompositeSummaryToDashboard(summary, getMockDashboard("admin"));
  const received = mapped.kpis.find((k) => k.key === "liveTransfers");
  assert.equal(received?.label, "Leads Received");
  assert.equal(received?.value, 10);
  assert.equal(isCompositeSummaryUsable(summary), true);
});
