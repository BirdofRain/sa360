import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isTerritoryInteractive } from "./display";
import { getPipelineStudioFixture } from "./fixtures";

/**
 * Pure helpers mirroring toggle semantics used by usePipelineStudioState.
 * Keeps coverage of local selection rules without mounting React.
 */
function toggleTerritory(
  territories: ReturnType<typeof getPipelineStudioFixture>["territories"],
  stateCode: string
) {
  return territories.map((t) => {
    if (t.stateCode !== stateCode || !isTerritoryInteractive(t)) return t;
    return { ...t, selected: !t.selected };
  });
}

function toggleDestination(
  destinations: ReturnType<typeof getPipelineStudioFixture>["destinations"],
  id: string,
  canModify: boolean
) {
  if (!canModify) return destinations;
  return destinations.map((d) =>
    d.id === id ? { ...d, enabled: !d.enabled } : d
  );
}

describe("pipeline studio local selection rules", () => {
  it("toggles interactive territories only", () => {
    const model = getPipelineStudioFixture();
    const next = toggleTerritory(model.territories, "NC");
    const nc = next.find((t) => t.stateCode === "NC");
    const baseline = model.territories.find((t) => t.stateCode === "NC");
    assert.ok(nc && baseline);
    assert.notEqual(nc.selected, baseline.selected);
  });

  it("can select previously unselected interactive territories (PA)", () => {
    const model = getPipelineStudioFixture();
    const pa = model.territories.find((t) => t.stateCode === "PA");
    assert.ok(pa);
    assert.equal(pa.selected, false);
    assert.equal(isTerritoryInteractive(pa), true);
    const next = toggleTerritory(model.territories, "PA");
    assert.equal(next.find((t) => t.stateCode === "PA")?.selected, true);
  });

  it("does not mutate destinations when canModifyDestinations is false", () => {
    const model = getPipelineStudioFixture();
    const first = model.destinations[0]!;
    const next = toggleDestination(model.destinations, first.id, false);
    assert.equal(next[0]!.enabled, first.enabled);
  });

  it("toggles destination enabled locally when allowed", () => {
    const model = getPipelineStudioFixture();
    const first = model.destinations[0]!;
    const next = toggleDestination(model.destinations, first.id, true);
    assert.notEqual(next[0]!.enabled, first.enabled);
  });
});
