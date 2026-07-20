import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMetricsStrip } from "./display";
import { getPipelineStudioFixture, PIPELINE_STUDIO_FIXTURE } from "./fixtures";
import { PIPELINE_STUDIO_PROTOTYPE_NOTICE } from "./types";

const REQUIRED_STATES = ["NC", "SC", "GA", "FL", "TN", "VA", "PA"] as const;

describe("pipeline studio read model / fixtures", () => {
  it("exposes a complete mock read model with required sections", () => {
    const model = getPipelineStudioFixture();
    assert.equal(model.dataSource, "mock");
    assert.ok(model.pipeline.id);
    assert.ok(model.pipeline.name);
    assert.ok(model.pipeline.version);
    assert.ok(model.pipeline.status);
    assert.ok(model.pipeline.updatedAt);
    assert.equal(model.origin.city, "Raleigh");
    assert.equal(model.origin.state, "NC");
    assert.ok(typeof model.origin.latitude === "number");
    assert.ok(typeof model.origin.longitude === "number");
    assert.ok(model.territories.length >= 7);
    assert.ok(model.destinations.length >= 3);
    assert.ok(model.rules.dailyCap > 0);
    assert.ok(model.metrics.deliveredLastSevenDays > 0);
    assert.ok(model.compliance.status);
    assert.ok(model.mapStates.some((s) => s.focus));
    assert.ok(model.routes.length >= 1);
  });

  it("includes the approved southeast / mid-atlantic fixture territories", () => {
    const codes = new Set(
      PIPELINE_STUDIO_FIXTURE.territories.map((t) => t.stateCode)
    );
    for (const code of REQUIRED_STATES) {
      assert.ok(codes.has(code), `missing territory ${code}`);
    }
  });

  it("requires age buckets, inventory counts, and health on every territory", () => {
    for (const t of PIPELINE_STUDIO_FIXTURE.territories) {
      assert.ok(t.stateName.length > 0);
      assert.ok(t.availableCount >= 0);
      assert.ok(t.estimatedLeadsPerDay >= 0);
      assert.ok(t.ageBuckets.length >= 1);
      assert.ok(t.health);
      assert.ok(t.routeType);
    }
  });

  it("sets canPublish to false and keeps publish/save/validate disabled", () => {
    const { capabilities } = PIPELINE_STUDIO_FIXTURE;
    assert.equal(capabilities.canPublish, false);
    assert.equal(capabilities.canSaveDraft, false);
    assert.equal(capabilities.canValidate, false);
  });

  it("defines the exact prototype notice constant", () => {
    assert.equal(
      PIPELINE_STUDIO_PROTOTYPE_NOTICE,
      "Visual prototype using fixture data. Existing inventory and fulfillment systems are unchanged."
    );
  });

  it("clones fixtures so local mutations cannot corrupt the source", () => {
    const a = getPipelineStudioFixture();
    const b = getPipelineStudioFixture();
    a.territories[0]!.selected = !a.territories[0]!.selected;
    assert.notEqual(a.territories[0]!.selected, b.territories[0]!.selected);
    assert.equal(
      PIPELINE_STUDIO_FIXTURE.territories[0]!.selected,
      b.territories[0]!.selected
    );
  });

  it("builds metric strip cards from the read model without ad hoc fixture imports", () => {
    const cards = buildMetricsStrip(getPipelineStudioFixture());
    assert.ok(cards.length >= 4);
    assert.ok(cards.every((c) => c.key && c.label && c.value));
  });

  it("includes CRM, Power Dialer, and Auto Follow-Up destinations", () => {
    const names = PIPELINE_STUDIO_FIXTURE.destinations.map((d) => d.name);
    assert.ok(names.includes("CRM"));
    assert.ok(names.includes("Power Dialer"));
    assert.ok(names.includes("Auto Follow-Up"));
  });
});
