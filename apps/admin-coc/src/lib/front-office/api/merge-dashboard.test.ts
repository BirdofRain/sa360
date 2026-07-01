import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeDashboard } from "./merge-dashboard";
import { getMockDashboard } from "../mock/dashboard";

describe("mergeDashboard", () => {
  it("merges live KPI values for admin", () => {
    const mock = getMockDashboard("admin");
    const merged = mergeDashboard(mock, {
      appointmentsBooked: 999,
      leadsDelivered: 1200,
    }, "admin");

    const appt = merged.kpis.find((k) => k.key === "appointmentsBooked");
    const delivered = merged.kpis.find((k) => k.key === "leadsDelivered");
    assert.equal(appt?.value, 999);
    assert.equal(delivered?.value, 1200);
    assert.equal(merged.dataSource, "mixed");
  });

  it("does not overwrite client-scoped mock with admin live slice semantics", () => {
    const mock = getMockDashboard("client");
    const merged = mergeDashboard(
      mock,
      { appointmentsBooked: 999, leadsDelivered: 5000 },
      "client"
    );
    const appt = merged.kpis.find((k) => k.key === "appointmentsBooked");
    assert.equal(appt?.value, 999);
    assert.equal(merged.dataSource, "mixed");
  });
});
