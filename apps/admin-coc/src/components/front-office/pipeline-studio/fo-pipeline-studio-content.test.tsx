import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanup, render, screen } from "@testing-library/react";

import { getPipelineStudioFixture } from "@/lib/front-office/pipeline-studio/fixtures";
import { PIPELINE_STUDIO_PROTOTYPE_NOTICE } from "@/lib/front-office/pipeline-studio/types";

import { FoPipelineStudioContent } from "./fo-pipeline-studio-content";

describe("FoPipelineStudioContent", () => {
  it("renders the exact prototype notice", () => {
    render(<FoPipelineStudioContent model={getPipelineStudioFixture()} />);
    assert.equal(
      screen.getByTestId("pipeline-studio-prototype-notice").textContent,
      PIPELINE_STUDIO_PROTOTYPE_NOTICE
    );
    cleanup();
  });

  it("keeps publish control disabled with no real publish action", () => {
    const model = getPipelineStudioFixture();
    assert.equal(model.capabilities.canPublish, false);
    render(<FoPipelineStudioContent model={model} />);
    const publish = screen.getByTestId("pipeline-studio-publish");
    assert.equal((publish as HTMLButtonElement).disabled, true);
    assert.equal(publish.getAttribute("aria-disabled"), "true");
    cleanup();
  });

  it("renders pipeline identity and Raleigh origin", () => {
    const model = getPipelineStudioFixture();
    render(<FoPipelineStudioContent model={model} />);
    assert.ok(screen.getByText(model.pipeline.name));
    assert.ok(screen.getAllByText(/Raleigh/i).length >= 1);
    assert.ok(screen.getByText(/UTC/));
    cleanup();
  });
});
