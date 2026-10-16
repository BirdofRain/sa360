import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { BuyerAvailabilityPanel } from "./buyer-availability-panel";

const exactReport = {
  ok: true,
  readOnly: true,
  evaluatedAt: "2026-08-24T00:00:00.000Z",
  buyer: { clientAccountId: "client_jr_laird", clientDisplayName: "JR Laird" },
  nicheKey: "trucker",
  states: ["GA"],
  allAgedTiers: true,
  queryCompleteness: "complete",
  eligibleCountSemantics: "exact",
  eligibleTotal: 4,
  ageTiers: [
    {
      commerceAgeBucketKey: "COMMERCE_1_3_MO",
      minDaysInclusive: 30,
      maxDaysExclusive: 90,
      eligible: 4,
      classified: 4,
      countSemantics: "exact",
    },
  ],
  structuralCohort: {
    countSemantics: "exact",
    rows: 9,
    availableActiveLot: 6,
    reserved: 1,
    committed: 0,
    commerceExcluded: 1,
    openAllocationOnAvailable: 0,
    stampedSameOrigin: 1,
    stampedOtherOrigin: 4,
    unstampedSelectable: 1,
    unstampedNotReconcilable: 1,
  },
  exclusionReasons: {
    originClientStamped: { count: 1, countSemantics: "exact" },
    originUnresolved: { count: 1, countSemantics: "exact" },
    existingAllocation: { count: 0, countSemantics: "exact" },
    reserved: { count: 1, countSemantics: "exact" },
    sameBuyerPriorDelivery: { count: 0, countSemantics: "exact" },
  },
  provenance: {
    stampedConfirmed: 5,
    reconciledFromSourceFunnel: 0,
    unresolvedOrigin: 1,
    unresolvedReasons: { provider_not_reconcilable: 1 },
    unstampedNotClassified: 0,
    coverageNote: "A missing origin is unresolved and is not counted as buyer-eligible.",
  },
  scan: {
    rowsClassified: 6,
    selectableRowsExact: 6,
    rowsUnclassified: 0,
    ceilingHit: false,
    usesSelectionRowCap: false,
  },
  summary: "Exact buyer-eligible count is 4.",
  snapshot: {
    isolation: "repeatable_read" as const,
    consistent: true as const,
    readOnly: true as const,
    scope: "transaction_start" as const,
  },
};

afterEach(() => {
  cleanup();
});

describe("BuyerAvailabilityPanel", () => {
  it("stays hidden as a lookup when the feature flag is off", () => {
    render(<BuyerAvailabilityPanel enabled={false} clients={[]} />);
    assert.match(
      screen.getByTestId("buyer-availability-disabled").textContent ?? "",
      /SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED/
    );
    assert.equal(screen.queryByTestId("buyer-availability-submit"), null);
  });

  it("shows an exact tier count and does not invent a capped total", async () => {
    const previous = globalThis.fetch;
    let body = "";
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = String(init?.body ?? "");
      return new Response(JSON.stringify(exactReport), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      render(
        <BuyerAvailabilityPanel
          enabled
          clients={[{ id: "client_jr_laird", label: "JR Laird" }]}
        />
      );
      fireEvent.change(screen.getByTestId("buyer-availability-client"), {
        target: { value: "client_jr_laird" },
      });
      fireEvent.click(screen.getByTestId("buyer-availability-submit"));
      const total = await screen.findByTestId("buyer-availability-total");
      assert.match(total.textContent ?? "", /JR Laird/);
      assert.match(total.textContent ?? "", /4 buyer-eligible/);
      assert.match(total.textContent ?? "", /\(exact\)/);
      assert.equal((total.textContent ?? "").includes("5000"), false);
      assert.match(screen.getByTestId("buyer-availability-snapshot").textContent ?? "", /repeatable-read snapshot/);
      assert.match(body, /"nicheKey":"trucker"/);
      assert.match(body, /"states":\["GA"\]/);
      assert.equal(body.includes("commerceAgeBucketKeys"), false);
    } finally {
      globalThis.fetch = previous;
    }
  });

  it("labels an incomplete scan as a lower bound and leaves unscanned tiers unreached", async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ...exactReport,
          queryCompleteness: "incomplete",
          eligibleCountSemantics: "lower_bound",
          eligibleTotal: 1,
          summary: "Buyer-eligible count 1 is a lower bound, not a catalog total.",
          ageTiers: [
            {
              commerceAgeBucketKey: "COMMERCE_12_MO_PLUS",
              minDaysInclusive: 365,
              maxDaysExclusive: null,
              eligible: 1,
              classified: 1,
              countSemantics: "lower_bound",
            },
            {
              commerceAgeBucketKey: "COMMERCE_1_3_MO",
              minDaysInclusive: 30,
              maxDaysExclusive: 90,
              eligible: null,
              classified: 0,
              countSemantics: "not_reached",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;
    try {
      render(<BuyerAvailabilityPanel enabled clients={[]} />);
      fireEvent.change(screen.getByTestId("buyer-availability-client-id"), {
        target: { value: "client_jr_laird" },
      });
      fireEvent.click(screen.getByTestId("buyer-availability-submit"));
      const total = await screen.findByTestId("buyer-availability-total");
      assert.match(total.textContent ?? "", /at least 1 buyer-eligible/);
      assert.match(total.textContent ?? "", /lower bound/);
      assert.match(
        screen.getByTestId("buyer-availability-tier-row-COMMERCE_1_3_MO").textContent ?? "",
        /not reached/
      );
      assert.equal((total.textContent ?? "").includes("5000"), false);
    } finally {
      globalThis.fetch = previous;
    }
  });
});
