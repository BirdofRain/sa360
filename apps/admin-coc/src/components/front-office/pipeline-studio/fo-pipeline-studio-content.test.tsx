import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanup, render, screen } from "@testing-library/react";

import { getInventoryExplorerFixture } from "@/lib/front-office/pipeline-studio/inventory-fixtures";
import { INVENTORY_EXPLORER_SAFETY_LINE } from "@/lib/front-office/pipeline-studio/inventory-types";

import { FoPipelineStudioContent } from "./fo-pipeline-studio-content";

describe("FoPipelineStudioContent (Inventory Explorer alias)", () => {
  it("serves Inventory Explorer at the pipeline-studio route entry", () => {
    render(<FoPipelineStudioContent model={getInventoryExplorerFixture()} />);
    assert.equal(
      screen.getByTestId("inventory-explorer-notice").textContent,
      INVENTORY_EXPLORER_SAFETY_LINE
    );
    assert.ok(screen.getByTestId("inventory-explorer"));
    cleanup();
  });
});
