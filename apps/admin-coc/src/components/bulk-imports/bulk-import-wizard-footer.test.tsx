import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { BulkImportWizardFooter } from "./bulk-import-wizard-footer.tsx";
import type { WizardFooterConfig } from "@/lib/bulk-imports/wizard-footer-config.ts";

const saveConfig: WizardFooterConfig = {
  previousViewStep: "map",
  previousLabel: "← Previous: Map",
  primaryLabel: "Save destination",
  primaryDisabled: false,
  primaryAction: "save-destination",
};

test.afterEach(() => {
  cleanup();
});

test("footer renders at bottom with previous and primary buttons", () => {
  render(
    <BulkImportWizardFooter
      config={saveConfig}
      viewStep="destination"
      onPrevious={() => {}}
      onPrimary={() => {}}
    />
  );
  const footer = screen.getByTestId("wizard-footer-destination");
  assert.ok(footer);
  const buttons = screen.getAllByRole("button");
  assert.equal(buttons.length, 2);
  for (const button of buttons) {
    assert.equal(button.getAttribute("type"), "button");
  }
  assert.ok(screen.getByRole("button", { name: "Save destination" }));
  assert.ok(screen.getByRole("button", { name: "← Previous: Map" }));
});

test("footer primary button is type button", () => {
  render(
    <BulkImportWizardFooter
      config={saveConfig}
      viewStep="destination"
      onPrimary={() => {}}
    />
  );
  assert.equal(
    screen.getByRole("button", { name: "Save destination" }).getAttribute("type"),
    "button"
  );
});
