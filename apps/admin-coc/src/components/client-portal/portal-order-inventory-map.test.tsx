import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  criteria: {
    nicheKey: "vet",
    productType: null,
    requestedAgeBucket: "COMMERCE_1_3_MO",
    requestedQuantity: 100,
  },
  states: [
    { state: "TX", availability: "Available" },
    { state: "CA", availability: "Limited" },
  ],
};

const loadAvailable: PortalInventoryAvailabilityLoader = async () => availableResponse;

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
