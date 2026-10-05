import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type {
  PortalInventoryMapLoadResult,
  PortalInventoryMapModel,
} from "@/lib/client-portal/portal-inventory-map";

import { PortalInventoryMap, type PortalInventoryMapLoader } from "./portal-inventory-map.tsx";

function liveModel(overrides: Partial<PortalInventoryMapModel> = {}): PortalInventoryMapModel {
  return {
    dataStatus: "live",
    evaluatedAt: new Date().toISOString(),
    nicheKey: "vet",
    productType: null,
    states: { TX: "Available", NC: "Limited", WY: "Currently unavailable" },
    summary: { Available: 1, Limited: 1, "Currently unavailable": 1 },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test("loading state keeps the map usable and announces busy", async () => {
  const pending = deferred<PortalInventoryMapLoadResult>();
  const toggled: string[] = [];
  render(
    <PortalInventoryMap
      nicheKey="vet"
      selectedStates={[]}
      onToggleState={(code) => toggled.push(code)}
      loadAvailability={() => pending.promise}
    />
  );
  const section = screen.getByTestId("portal-inventory-map");
  assert.equal(section.getAttribute("aria-busy"), "true");
  assert.ok(screen.getByText("Checking live availability…"));
  fireEvent.click(screen.getByTestId("portal-map-state-TX"));
  assert.deepEqual(toggled, ["TX"]);
  assert.equal(screen.getByTestId("portal-map-state-TX").getAttribute("data-tone"), "unknown");
  pending.resolve({ ok: true, model: liveModel() });
  await waitFor(() => assert.equal(section.getAttribute("data-status"), "ready"));
  cleanup();
});

test("renders live tones, titles, and legend; clicking toggles without any write", async () => {
  const toggled: string[] = [];
  let calls = 0;
  render(
    <PortalInventoryMap
      nicheKey="vet"
      nicheLabel="Veteran"
      selectedStates={["NC"]}
      onToggleState={(code) => toggled.push(code)}
      loadAvailability={async () => {
        calls += 1;
        return { ok: true, model: liveModel() };
      }}
    />
  );
  await waitFor(() =>
    assert.equal(screen.getByTestId("portal-inventory-map").getAttribute("data-status"), "ready")
  );
  assert.equal(calls, 1);
  assert.equal(screen.getByTestId("portal-map-state-TX").getAttribute("data-tone"), "Available");
  assert.equal(screen.getByTestId("portal-map-state-NC").getAttribute("data-tone"), "Limited");
  assert.equal(
    screen.getByTestId("portal-map-state-WY").getAttribute("data-tone"),
    "Currently unavailable"
  );
  assert.equal(screen.getByTestId("portal-map-state-CA").getAttribute("data-tone"), "unknown");
  assert.equal(screen.getByTestId("portal-map-state-NC").getAttribute("aria-pressed"), "true");
  assert.equal(screen.getByTestId("portal-map-state-TX").getAttribute("aria-pressed"), "false");
  assert.ok(screen.getByRole("button", { name: /Texas \(TX\): Available/ }));
  assert.ok(screen.getByRole("button", { name: /North Carolina \(NC\): Limited · selected/ }));
  assert.ok(screen.getByText(/Showing Veteran/));
  assert.ok(screen.getByText(/Checked just now/));
  assert.ok(screen.getByTestId("portal-inventory-map-legend"));
  assert.ok(screen.getByText("Selected states: 1 limited"));
  assert.ok(screen.getByText(/Nothing is reserved or ordered from this map/));

  fireEvent.click(screen.getByTestId("portal-map-state-TX"));
  fireEvent.keyDown(screen.getByTestId("portal-map-state-WY"), { key: "Enter" });
  fireEvent.keyDown(screen.getByTestId("portal-map-state-CA"), { key: " " });
  assert.deepEqual(toggled, ["TX", "WY", "CA"]);
  assert.equal(screen.queryByTestId("portal-inventory-map-empty"), null);
  cleanup();
});

test("error state shows a retry affordance and still toggles states", async () => {
  let attempt = 0;
  const toggled: string[] = [];
  const loader: PortalInventoryMapLoader = async () => {
    attempt += 1;
    if (attempt === 1) return { ok: false, error: "Availability check failed." };
    return { ok: true, model: liveModel() };
  };
  render(
    <PortalInventoryMap
      nicheKey="vet"
      selectedStates={[]}
      onToggleState={(code) => toggled.push(code)}
      loadAvailability={loader}
    />
  );
  await waitFor(() => assert.ok(screen.getByRole("alert")));
  assert.ok(screen.getByText("Availability check failed."));
  assert.equal(screen.getByTestId("portal-map-state-TX").getAttribute("data-tone"), "unknown");
  fireEvent.click(screen.getByTestId("portal-map-state-TX"));
  assert.deepEqual(toggled, ["TX"]);

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() =>
    assert.equal(screen.getByTestId("portal-map-state-TX").getAttribute("data-tone"), "Available")
  );
  assert.equal(screen.queryByRole("alert"), null);
  assert.equal(attempt, 2);
  cleanup();
});

test("thrown loader errors degrade to the generic error copy", async () => {
  render(
    <PortalInventoryMap
      nicheKey="vet"
      selectedStates={[]}
      onToggleState={() => {}}
      loadAvailability={async () => {
        throw new Error("network down");
      }}
    />
  );
  await waitFor(() => assert.ok(screen.getByRole("alert")));
  assert.ok(screen.getByText(/could not check live availability/i));
  assert.equal(screen.queryByText("network down"), null);
  cleanup();
});

test("empty live inventory shows an explicit empty state", async () => {
  render(
    <PortalInventoryMap
      nicheKey="trucker"
      nicheLabel="Trucker"
      selectedStates={[]}
      onToggleState={() => {}}
      loadAvailability={async () => ({
        ok: true,
        model: liveModel({
          nicheKey: "trucker",
          states: { TX: "Currently unavailable" },
          summary: { Available: 0, Limited: 0, "Currently unavailable": 1 },
        }),
      })}
    />
  );
  await waitFor(() => assert.ok(screen.getByTestId("portal-inventory-map-empty")));
  assert.ok(screen.getByText(/No live inventory for Trucker/));
  cleanup();
});

test("unavailable read model explains itself and renders unknown tones", async () => {
  render(
    <PortalInventoryMap
      nicheKey="vet"
      selectedStates={[]}
      onToggleState={() => {}}
      loadAvailability={async () => ({
        ok: true,
        model: liveModel({
          dataStatus: "unavailable",
          states: {},
          summary: { Available: 0, Limited: 0, "Currently unavailable": 0 },
        }),
      })}
    />
  );
  await waitFor(() => assert.ok(screen.getByRole("status")));
  assert.ok(screen.getByText(/could not be computed/));
  assert.equal(screen.getByTestId("portal-map-state-TX").getAttribute("data-tone"), "unknown");
  cleanup();
});

test("refetches when the lead type changes and respects the selection limit", async () => {
  const seen: Array<string | null> = [];
  const toggled: string[] = [];
  const loader: PortalInventoryMapLoader = async (query) => {
    seen.push(query.nicheKey);
    return { ok: true, model: liveModel({ nicheKey: query.nicheKey }) };
  };
  const view = render(
    <PortalInventoryMap
      nicheKey="vet"
      selectedStates={["NC"]}
      atSelectionLimit
      onToggleState={(code) => toggled.push(code)}
      loadAvailability={loader}
    />
  );
  await waitFor(() => assert.deepEqual(seen, ["vet"]));
  fireEvent.click(screen.getByTestId("portal-map-state-TX"));
  fireEvent.click(screen.getByTestId("portal-map-state-NC"));
  assert.deepEqual(toggled, ["NC"], "only deselecting is allowed at the limit");
  assert.equal(screen.getByTestId("portal-map-state-TX").getAttribute("aria-disabled"), "true");

  view.rerender(
    <PortalInventoryMap
      nicheKey="nurse"
      selectedStates={["NC"]}
      atSelectionLimit
      onToggleState={(code) => toggled.push(code)}
      loadAvailability={loader}
    />
  );
  await waitFor(() => assert.deepEqual(seen, ["vet", "nurse"]));
  cleanup();
});
