import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import {
  buildPortalOrderRequestCatalogs,
  type PortalOrderRequestOption,
} from "@/lib/client-portal/portal-order-request";
import type { PortalInventoryAvailabilityResponse } from "@/lib/client-portal/portal-inventory-map";

import {
  PortalOrderInventoryMap,
  type PortalInventoryAvailabilityLoader,
} from "./portal-order-inventory-map.tsx";

afterEach(cleanup);

const states = buildPortalOrderRequestCatalogs({}).states;

const availableResponse: PortalInventoryAvailabilityResponse = {
  ok: true,
  evaluatedAt: "2026-10-09T14:00:00.000Z",
  stale: false,
  mappingSupported: true,
  mappingNote: "Mapped source bands.",
  lookupStatus: "ready",
  criteria: {
    nicheKey: "vet",
    requestedAgeBucket: "COMMERCE_1_3_MO",
    requestedQuantity: 100,
  },
  states: [
    { state: "TX", availability: "Available" },
    { state: "CA", availability: "Limited" },
    { state: "FL", availability: null },
  ],
};

const loadAvailable: PortalInventoryAvailabilityLoader = async () => availableResponse;

function availabilityResponse(
  nicheKey: string,
  availability: "Available" | "Limited",
  mappingNote: string
): PortalInventoryAvailabilityResponse {
  return {
    ...availableResponse,
    mappingNote,
    criteria: { ...availableResponse.criteria, nicheKey },
    states: [{ state: "TX", availability }],
  };
}

function Harness({
  initial = [],
  stateOptions = states,
  loader = loadAvailable,
}: {
  initial?: string[];
  stateOptions?: PortalOrderRequestOption[];
  loader?: PortalInventoryAvailabilityLoader;
}) {
  const [selected, setSelected] = useState(initial);
  return (
    <PortalOrderInventoryMap
      states={stateOptions}
      selectedStates={selected}
      onToggleState={(code) =>
        setSelected((current) =>
          current.includes(code)
            ? current.filter((state) => state !== code)
            : current.length >= 20
              ? current
              : [...current, code]
        )
      }
      maxSelectedStates={20}
      nicheKey="vet"
      productType=""
      requestedAgeBucket="COMMERCE_1_3_MO"
      requestedQuantity={100}
      loadAvailability={loader}
    />
  );
}

test("map and searchable list share one controlled state selection", async () => {
  render(<Harness />);
  await screen.findByText("Mapped source bands.");

  const texasMap = screen.getByTestId("portal-map-state-TX");
  fireEvent.click(texasMap);
  assert.equal(texasMap.getAttribute("aria-pressed"), "true");
  assert.equal((screen.getByLabelText("TX · Texas") as HTMLInputElement).checked, true);
  assert.ok(screen.getByText("1 of 20 selected"));

  fireEvent.change(screen.getByLabelText("Search states"), { target: { value: "California" } });
  const californiaList = screen.getByLabelText("CA · California");
  fireEvent.click(californiaList);
  assert.equal(
    screen.getByTestId("portal-map-state-CA").getAttribute("aria-pressed"),
    "true"
  );
  assert.ok(screen.getByText("2 of 20 selected"));
});

test("selection limit disables unselected map and list controls but permits deselection", async () => {
  const selected = states.slice(0, 20).map((state) => state.value);
  render(<Harness initial={selected} />);
  await screen.findByText("Mapped source bands.");

  const unselected = states[20]!;
  assert.equal(
    screen.getByTestId(`portal-map-state-${unselected.value}`).getAttribute("aria-disabled"),
    "true"
  );
  assert.equal((screen.getByLabelText(unselected.label) as HTMLInputElement).disabled, true);

  fireEvent.click(screen.getByLabelText(states[0]!.label));
  assert.equal(
    screen.getByTestId(`portal-map-state-${unselected.value}`).getAttribute("aria-disabled"),
    "false"
  );
});

test("stale and error responses remain manually selectable and never reserve inventory", async () => {
  const staleLoader: PortalInventoryAvailabilityLoader = async () => ({
    ...availableResponse,
    stale: true,
  });
  const { unmount } = render(<Harness loader={staleLoader} />);
  assert.ok(await screen.findByText(/Availability may be stale/i));
  assert.match(screen.getByText(/Availability is informational/i).textContent ?? "", /not a reservation/i);
  assert.equal(screen.queryByRole("button", { name: /reserve/i }), null);
  unmount();

  const errorLoader: PortalInventoryAvailabilityLoader = async () => {
    throw new Error("Inventory service unavailable.");
  };
  render(<Harness loader={errorLoader} />);
  await waitFor(() => assert.ok(screen.getByRole("alert")));
  assert.match(screen.getByRole("alert").textContent ?? "", /select states manually/i);
  fireEvent.click(screen.getByTestId("portal-map-state-TX"));
  assert.equal(screen.getByTestId("portal-map-state-TX").getAttribute("aria-pressed"), "true");
});

test("filter changes hide old tiers while the newest availability request is loading", async () => {
  const pendingLoader: PortalInventoryAvailabilityLoader = async () => {
    return new Promise<PortalInventoryAvailabilityResponse>(() => undefined);
  };
  const props = {
    states,
    selectedStates: [] as string[],
    onToggleState: () => undefined,
    maxSelectedStates: 20,
    productType: "",
    requestedAgeBucket: "COMMERCE_1_3_MO",
    requestedQuantity: 100,
  };
  const { rerender } = render(
    <PortalOrderInventoryMap
      {...props}
      nicheKey="vet"
      loadAvailability={loadAvailable}
    />
  );
  await screen.findByText("Mapped source bands.");
  assert.equal(
    screen.getByTestId("portal-map-state-TX").getAttribute("fill"),
    "#0f9f7a"
  );

  rerender(
    <PortalOrderInventoryMap
      {...props}
      nicheKey="nurse"
      loadAvailability={pendingLoader}
    />
  );
  await screen.findByText("Loading current availability…");
  assert.equal(screen.queryByText("Mapped source bands.") === null, true);
  assert.equal(
    screen.getByTestId("portal-map-state-TX").getAttribute("fill"),
    "#e2e8f0"
  );
  assert.match(
    screen.getByTestId("portal-map-state-TX").getAttribute("aria-label") ?? "",
    /availability unavailable/
  );
});

test("rapid out-of-order filter responses cannot replace the newest availability", async () => {
  const requests: Array<{
    input: Parameters<PortalInventoryAvailabilityLoader>[0];
    resolve: (response: PortalInventoryAvailabilityResponse) => void;
  }> = [];
  const deferredLoader: PortalInventoryAvailabilityLoader = (input) =>
    new Promise((resolve) => requests.push({ input, resolve }));
  const props = {
    states,
    selectedStates: [] as string[],
    onToggleState: () => undefined,
    maxSelectedStates: 20,
    productType: "",
    requestedAgeBucket: "COMMERCE_1_3_MO",
    requestedQuantity: 100,
    loadAvailability: deferredLoader,
  };
  const { rerender } = render(<PortalOrderInventoryMap {...props} nicheKey="vet" />);
  await waitFor(() => assert.equal(requests.length, 1));

  rerender(<PortalOrderInventoryMap {...props} nicheKey="nurse" />);
  await waitFor(() => assert.equal(requests.length, 2));
  rerender(<PortalOrderInventoryMap {...props} nicheKey="trucker" />);
  await waitFor(() => assert.equal(requests.length, 3));
  assert.equal(requests[0]!.input.signal.aborted, true);
  assert.equal(requests[1]!.input.signal.aborted, true);

  await act(async () => {
    requests[1]!.resolve(availabilityResponse("nurse", "Available", "Nurse response."));
  });
  assert.equal(screen.queryByText("Nurse response."), null);
  assert.ok(screen.getByRole("status"));

  await act(async () => {
    requests[2]!.resolve(availabilityResponse("trucker", "Limited", "Trucker response."));
  });
  assert.ok(await screen.findByText("Trucker response."));
  assert.equal(screen.queryByText("Nurse response."), null);
  assert.equal(
    screen.getByTestId("portal-map-state-TX").getAttribute("fill"),
    "#f59e0b"
  );
});

test("quantity changes refetch so bands follow the requested quantity", async () => {
  const requestedQuantities: number[] = [];
  const loader: PortalInventoryAvailabilityLoader = async (input) => {
    requestedQuantities.push(input.requestedQuantity);
    return {
      ...availableResponse,
      criteria: {
        ...availableResponse.criteria,
        requestedQuantity: input.requestedQuantity,
      },
      states:
        input.requestedQuantity >= 250
          ? [{ state: "TX", availability: "Limited" }]
          : availableResponse.states,
    };
  };
  const props = {
    states,
    selectedStates: [] as string[],
    onToggleState: () => undefined,
    maxSelectedStates: 20,
    nicheKey: "vet",
    productType: "",
    requestedAgeBucket: "COMMERCE_1_3_MO",
    loadAvailability: loader,
  };
  const { rerender } = render(
    <PortalOrderInventoryMap {...props} requestedQuantity={100} />
  );
  await screen.findByText("Mapped source bands.");
  assert.deepEqual(requestedQuantities, [100]);
  assert.equal(screen.getByTestId("portal-map-state-TX").getAttribute("fill"), "#0f9f7a");
  assert.equal(screen.getByTestId("portal-map-state-FL").getAttribute("fill"), "#e2e8f0");
  assert.match(
    screen.getByTestId("portal-map-state-FL").getAttribute("aria-label") ?? "",
    /availability unavailable/
  );
  assert.equal(
    (screen.getByTestId("portal-map-state-FL").getAttribute("aria-label") ?? "").includes(
      "Currently unavailable"
    ),
    false
  );

  rerender(<PortalOrderInventoryMap {...props} requestedQuantity={250} />);
  await waitFor(() => assert.deepEqual(requestedQuantities, [100, 250]));
  assert.match(
    screen.getByText(/Availability is informational/).textContent ?? "",
    /250 leads/
  );
  assert.equal(screen.getByTestId("portal-map-state-TX").getAttribute("fill"), "#f59e0b");

  rerender(<PortalOrderInventoryMap {...props} requestedQuantity={0} />);
  assert.deepEqual(requestedQuantities, [100, 250]);
  assert.equal(screen.getByTestId("portal-map-state-TX").getAttribute("fill"), "#e2e8f0");
  assert.equal(screen.queryByTestId("portal-map-tier-legend"), null);
});

test("6–12 loads its own bands and does not keep another range's colors", async () => {
  const calls: string[] = [];
  const loader: PortalInventoryAvailabilityLoader = async (input) => {
    calls.push(input.requestedAgeBucket);
    if (input.requestedAgeBucket === "COMMERCE_6_12_MO") {
      return {
        ...availableResponse,
        evaluatedAt: "2026-10-09T14:05:00.000Z",
        mappingNote: "Buyer eligible 6–12.",
        criteria: {
          nicheKey: "vet",
          requestedAgeBucket: "COMMERCE_6_12_MO",
          requestedQuantity: input.requestedQuantity,
        },
        states: [
          { state: "CA", availability: "Limited" },
          { state: "TX", availability: null },
        ],
      };
    }
    return {
      ...availableResponse,
      criteria: {
        ...availableResponse.criteria,
        requestedQuantity: input.requestedQuantity,
      },
    };
  };
  const props = {
    states,
    selectedStates: ["TX"],
    onToggleState: () => undefined,
    maxSelectedStates: 20,
    nicheKey: "vet",
    productType: "",
    requestedQuantity: 100,
    loadAvailability: loader,
  };
  const { rerender } = render(
    <PortalOrderInventoryMap {...props} requestedAgeBucket="COMMERCE_1_3_MO" />
  );
  await screen.findByText("Mapped source bands.");
  assert.equal(screen.getByTestId("portal-map-state-TX").getAttribute("fill"), "#0f9f7a");
  assert.ok(screen.getByTestId("portal-map-tier-legend"));

  rerender(<PortalOrderInventoryMap {...props} requestedAgeBucket="COMMERCE_6_12_MO" />);
  await screen.findByText("Buyer eligible 6–12.");
  assert.deepEqual(calls, ["COMMERCE_1_3_MO", "COMMERCE_6_12_MO"]);
  assert.equal(screen.getByTestId("portal-map-state-TX").getAttribute("fill"), "#e2e8f0");
  assert.equal(screen.getByTestId("portal-map-state-CA").getAttribute("fill"), "#f59e0b");
  assert.ok(screen.getByTestId("portal-map-tier-legend"));
  assert.equal(screen.queryByText("Mapped source bands."), null);
  assert.equal(screen.getByTestId("portal-map-state-TX").getAttribute("aria-pressed"), "true");
  assert.match(screen.getByTestId("portal-map-unknown-caption").textContent ?? "", /not mean zero inventory/);
  assert.equal(
    screen.getByTestId("portal-map-evaluated-at").getAttribute("datetime"),
    "2026-10-09T14:05:00.000Z"
  );
});

test("a disabled 6–12 lookup stays gray and hides the colored legend", async () => {
  const loader: PortalInventoryAvailabilityLoader = async (input) => {
    if (input.requestedAgeBucket === "COMMERCE_6_12_MO") {
      return {
        ok: true,
        evaluatedAt: null,
        stale: false,
        mappingSupported: false,
        mappingNote: "Availability lookup is disabled.",
        lookupStatus: "disabled",
        criteria: {
          nicheKey: "vet",
          requestedAgeBucket: "COMMERCE_6_12_MO",
          requestedQuantity: input.requestedQuantity,
        },
        states: [],
      };
    }
    return {
      ...availableResponse,
      criteria: {
        ...availableResponse.criteria,
        requestedQuantity: input.requestedQuantity,
      },
    };
  };
  const props = {
    states,
    selectedStates: ["TX"],
    onToggleState: () => undefined,
    maxSelectedStates: 20,
    nicheKey: "vet",
    productType: "",
    requestedQuantity: 100,
    loadAvailability: loader,
  };
  const { rerender } = render(
    <PortalOrderInventoryMap {...props} requestedAgeBucket="COMMERCE_1_3_MO" />
  );
  await screen.findByText("Mapped source bands.");
  rerender(<PortalOrderInventoryMap {...props} requestedAgeBucket="COMMERCE_6_12_MO" />);
  const status = await screen.findByTestId("portal-map-lookup-status");
  assert.match(status.textContent ?? "", /Availability lookup is disabled/);
  assert.equal(screen.getByTestId("portal-map-state-TX").getAttribute("fill"), "#e2e8f0");
  assert.equal(screen.queryByTestId("portal-map-tier-legend"), null);
  assert.equal(screen.getByTestId("portal-map-state-TX").getAttribute("aria-pressed"), "true");
  assert.equal(screen.queryByText("Currently unavailable"), null);
});

test("an incomplete scan with no painted band hides the tier legend", async () => {
  const loader: PortalInventoryAvailabilityLoader = async (input) => ({
    ok: true,
    evaluatedAt: "2026-10-23T00:40:00.000Z",
    stale: false,
    mappingSupported: true,
    mappingNote: "Scan stopped before every eligible row was classified.",
    lookupStatus: "ready",
    criteria: {
      nicheKey: "vet",
      requestedAgeBucket: "COMMERCE_6_12_MO",
      requestedQuantity: input.requestedQuantity,
    },
    states: [
      { state: "FL", availability: null },
      { state: "TX", availability: null },
      { state: "GA", availability: null },
    ],
  });
  render(
    <PortalOrderInventoryMap
      states={states}
      selectedStates={[]}
      onToggleState={() => undefined}
      maxSelectedStates={20}
      nicheKey="vet"
      productType=""
      requestedAgeBucket="COMMERCE_6_12_MO"
      requestedQuantity={10}
      loadAvailability={loader}
    />
  );
  await screen.findByText("Scan stopped before every eligible row was classified.");
  assert.equal(screen.getByTestId("portal-map-state-FL").getAttribute("fill"), "#e2e8f0");
  assert.equal(screen.getByTestId("portal-map-state-GA").getAttribute("fill"), "#e2e8f0");
  assert.match(
    screen.getByTestId("portal-map-state-FL").getAttribute("aria-label") ?? "",
    /availability unavailable/
  );
  assert.equal(
    (screen.getByTestId("portal-map-state-FL").getAttribute("aria-label") ?? "").includes(
      "Limited"
    ),
    false
  );
  assert.equal(screen.queryByTestId("portal-map-tier-legend"), null);
  assert.equal(screen.queryByText("Currently unavailable"), null);
  assert.equal(screen.queryByText("Limited"), null);
  assert.match(
    screen.getByTestId("portal-map-unknown-caption").textContent ?? "",
    /does not mean zero inventory/
  );
});
