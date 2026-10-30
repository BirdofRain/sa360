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

  it("shows the all-states placeholder and searches with no state restriction when blank", async () => {
    const previous = globalThis.fetch;
    let body = "";
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          ...exactReport,
          stateScope: "all",
          states: ["GA", "TX"],
          summary: "All states. Exact buyer-eligible count is 4.",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;
    try {
      render(<BuyerAvailabilityPanel enabled clients={[]} />);
      const states = screen.getByTestId("buyer-availability-states");
      assert.equal(states.getAttribute("placeholder"), "All states");
      assert.match(
        screen.getByTestId("buyer-availability-states-help").textContent ?? "",
        /Leave blank to search all states\./
      );
      fireEvent.change(screen.getByTestId("buyer-availability-client-id"), {
        target: { value: "client_jr_laird" },
      });
      fireEvent.change(states, { target: { value: "   " } });
      fireEvent.click(screen.getByTestId("buyer-availability-submit"));
      const total = await screen.findByTestId("buyer-availability-total");
      const parsed = JSON.parse(body) as { states?: string[]; nicheKey?: string };
      assert.equal(parsed.states, undefined);
      assert.equal(parsed.nicheKey, "trucker");
      assert.match(total.textContent ?? "", /All states/);
      assert.match(total.textContent ?? "", /4 buyer-eligible/);
      assert.match(total.textContent ?? "", /\(exact\)/);
      assert.match(
        screen.getByTestId("buyer-availability-state-scope").textContent ?? "",
        /Coverage: All states/
      );
      assert.match(
        screen.getByTestId("buyer-availability-tier-row-COMMERCE_1_3_MO").textContent ?? "",
        /4/
      );
    } finally {
      globalThis.fetch = previous;
    }
  });

  it("labels an unfinished nationwide count as not a total", async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ...exactReport,
          stateScope: "all",
          states: ["GA", "TX"],
          queryCompleteness: "incomplete",
          eligibleCountSemantics: "lower_bound",
          eligibleTotal: 1,
          summary:
            "All states. Buyer-eligible count 1 is a lower bound from 1 classified rows, not a nationwide total.",
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
      fireEvent.change(screen.getByTestId("buyer-availability-states"), { target: { value: "" } });
      fireEvent.click(screen.getByTestId("buyer-availability-submit"));
      const total = await screen.findByTestId("buyer-availability-total");
      assert.match(total.textContent ?? "", /All states/);
      assert.match(total.textContent ?? "", /at least 1 buyer-eligible/);
      assert.match(total.textContent ?? "", /not a nationwide total/);
      assert.equal((total.textContent ?? "").includes("(exact)"), false);
      assert.match(
        screen.getByTestId("buyer-availability-tier-row-COMMERCE_1_3_MO").textContent ?? "",
        /not reached/
      );
    } finally {
      globalThis.fetch = previous;
    }
  });

  it("labels a finished multi-pass nationwide count as complete", async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ...exactReport,
          stateScope: "all",
          states: ["GA", "TX"],
          summary:
            "All states. Exact buyer-eligible count is 4. Counted across 2 passes of at most 100,000 classified rows under one snapshot.",
          scan: {
            ...exactReport.scan,
            classificationPasses: 2,
            continuedPastPassCeiling: true,
            ceilingHit: false,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;
    try {
      render(<BuyerAvailabilityPanel enabled clients={[]} />);
      fireEvent.change(screen.getByTestId("buyer-availability-client-id"), {
        target: { value: "client_jr_laird" },
      });
      fireEvent.change(screen.getByTestId("buyer-availability-states"), { target: { value: "" } });
      fireEvent.click(screen.getByTestId("buyer-availability-submit"));
      const total = await screen.findByTestId("buyer-availability-total");
      assert.match(total.textContent ?? "", /All states/);
      assert.match(total.textContent ?? "", /4 buyer-eligible/);
      assert.match(total.textContent ?? "", /\(exact\)/);
      assert.match(
        screen.getByTestId("buyer-availability-completion").textContent ?? "",
        /Status: complete/
      );
      assert.match(
        screen.getByTestId("buyer-availability-completion").textContent ?? "",
        /2 classification passes/
      );
      assert.match(
        screen.getByTestId("buyer-availability-completion").textContent ?? "",
        /2026-08-24T00:00:00.000Z/
      );
    } finally {
      globalThis.fetch = previous;
    }
  });

  it("rejects invalid state text instead of searching all states", async () => {
    const previous = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify(exactReport), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      render(<BuyerAvailabilityPanel enabled clients={[]} />);
      fireEvent.change(screen.getByTestId("buyer-availability-client-id"), {
        target: { value: "client_jr_laird" },
      });
      fireEvent.change(screen.getByTestId("buyer-availability-states"), {
        target: { value: "GA ZZ" },
      });
      fireEvent.click(screen.getByTestId("buyer-availability-submit"));
      const error = await screen.findByTestId("buyer-availability-error");
      assert.match(error.textContent ?? "", /Invalid: ZZ/);
      assert.equal(screen.queryByTestId("buyer-availability-result"), null);
      assert.equal(screen.queryByText(/Coverage: All states/), null);
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = previous;
    }
  });

  it("keeps a valid state selection on the request", async () => {
    const previous = globalThis.fetch;
    let body = "";
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = String(init?.body ?? "");
      return new Response(
        JSON.stringify({ ...exactReport, stateScope: "selected", states: ["GA", "TX"] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;
    try {
      render(<BuyerAvailabilityPanel enabled clients={[]} />);
      fireEvent.change(screen.getByTestId("buyer-availability-client-id"), {
        target: { value: "client_jr_laird" },
      });
      fireEvent.change(screen.getByTestId("buyer-availability-states"), {
        target: { value: "ga, tx" },
      });
      fireEvent.click(screen.getByTestId("buyer-availability-submit"));
      const total = await screen.findByTestId("buyer-availability-total");
      assert.deepEqual(JSON.parse(body).states, ["GA", "TX"]);
      assert.match(total.textContent ?? "", /GA, TX/);
      assert.match(total.textContent ?? "", /\(exact\)/);
      assert.match(
        screen.getByTestId("buyer-availability-state-scope").textContent ?? "",
        /Coverage: Selected states \(GA, TX\)/
      );
    } finally {
      globalThis.fetch = previous;
    }
  });
});
