import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

import { BulkImportMappingEditor } from "@/components/bulk-imports/bulk-import-mapping-editor.tsx";
import type { SaveBulkImportMappingResult } from "@/components/bulk-imports/bulk-import-mapping-editor.tsx";
import {
  applyMappingSaveToBatchState,
  isMappingSaveRequired,
  mappingSaveButtonLabel,
  resolveMappingSaveSuccessMessage,
  resolveMappingSaveWizardStep,
  shouldAdvanceWizardAfterMappingSave,
  shouldNoOpMappingSave,
} from "@/lib/bulk-imports/mapping-save-progression.ts";

const baseHeaders = ["first_name", "phone"];
const baseMapping = { first_name: "first_name", phone: "phone" };
const baseSuggestions = [
  { csvColumn: "first_name", suggestedCanonical: "first_name", confidence: "high" as const, action: "map" as const },
  { csvColumn: "phone", suggestedCanonical: "phone", confidence: "high" as const, action: "map" as const },
];
const basePreview = [{ rowNumber: 1, fields: { first_name: "Jane", phone: "+12025550101" } }];

let saveCalls = 0;
let lastSaveResult: SaveBulkImportMappingResult = {
  ok: true,
  mappingChanged: false,
  mappingConfirmed: true,
  confirmationChanged: true,
  resetPerformed: false,
  nextStep: "destination",
};

function renderEditor(
  overrides?: Partial<React.ComponentProps<typeof BulkImportMappingEditor>>
) {
  saveCalls = 0;
  return render(
    <BulkImportMappingEditor
      headers={baseHeaders}
      suggestions={baseSuggestions}
      previewRows={basePreview}
      savedMapping={baseMapping}
      missingRequired={[]}
      hasDownstreamArtifacts={false}
      mappingConfirmed={false}
      initialMode="edit"
      onSave={async () => {
        saveCalls += 1;
        return lastSaveResult;
      }}
      {...overrides}
    />
  );
}

test.afterEach(() => {
  cleanup();
});

test("unconfirmed suggested mapping enables confirmation with zero column changes", () => {
  renderEditor();
  const button = screen.getByRole("button", { name: "Confirm mapping & continue" });
  assert.equal(button.hasAttribute("disabled"), false);
  assert.equal(isMappingSaveRequired({ mappingConfirmed: false, mappingChanged: false }), true);
});

test("button says Confirm mapping & continue when mapping is unconfirmed", () => {
  assert.equal(
    mappingSaveButtonLabel({ mappingConfirmed: false, mappingChanged: false }),
    "Confirm mapping & continue"
  );
  assert.equal(
    mappingSaveButtonLabel({ mappingConfirmed: false, mappingChanged: false }, { saving: true }),
    "Confirming mapping…"
  );
});

test("clicking confirm sends exactly one save request for unchanged suggested mapping", async () => {
  renderEditor();
  fireEvent.click(screen.getByRole("button", { name: "Confirm mapping & continue" }));
  await waitFor(() => assert.equal(saveCalls, 1));
});

test("successful confirmation shows destination message not no-op text", async () => {
  renderEditor();
  fireEvent.click(screen.getByRole("button", { name: "Confirm mapping & continue" }));
  await waitFor(() =>
    assert.match(
      screen.getByText("Mapping confirmed. Opening Destination…").textContent ?? "",
      /Mapping confirmed/
    )
  );
  assert.equal(
    resolveMappingSaveSuccessMessage({
      mappingChanged: false,
      confirmationChanged: true,
      resetPerformed: false,
    }),
    "Mapping confirmed. Opening Destination…"
  );
  assert.notEqual(
    resolveMappingSaveSuccessMessage({
      mappingChanged: false,
      confirmationChanged: true,
      resetPerformed: false,
    }),
    "No mapping changes to save."
  );
});

test("returned batch with mappingConfirmed true is applied immediately", () => {
  const applied = applyMappingSaveToBatchState({
    id: "batch_1",
    status: "ready_for_review",
    wizardStepJson: { step: "destination", mappingConfirmed: true },
  });
  assert.equal(applied.mappingConfirmed, true);
  assert.equal(applied.wizardStep, "destination");
});

test("wizard advances to destination when nextStep is destination", () => {
  const nextStep = resolveMappingSaveWizardStep("destination");
  assert.equal(nextStep, "destination");
  assert.equal(shouldAdvanceWizardAfterMappingSave(nextStep), true);
  assert.equal(shouldAdvanceWizardAfterMappingSave("map"), false);
});

test("already-confirmed unchanged mapping remains a no-op", async () => {
  renderEditor({ mappingConfirmed: true, initialMode: "edit" });
  assert.equal(
    mappingSaveButtonLabel({ mappingConfirmed: true, mappingChanged: false }),
    "Save changes"
  );
  assert.equal(shouldNoOpMappingSave({ mappingConfirmed: true, mappingChanged: false }), true);
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    assert.equal(screen.getByText("No mapping changes to save.").textContent, "No mapping changes to save.")
  );
  assert.equal(saveCalls, 0);
});

test("first confirmation never invokes reset dialog", async () => {
  renderEditor({ hasDownstreamArtifacts: true });
  fireEvent.click(screen.getByRole("button", { name: "Confirm mapping & continue" }));
  await waitFor(() => assert.equal(saveCalls, 1));
  assert.equal(screen.queryByText(/RESET BULK IMPORT/i), null);
});

test("already-confirmed changed mapping still saves normally", async () => {
  lastSaveResult = {
    ok: true,
    mappingChanged: true,
    mappingConfirmed: true,
    confirmationChanged: false,
    resetPerformed: false,
    nextStep: "destination",
  };
  renderEditor({ mappingConfirmed: true, initialMode: "edit" });
  const selects = screen.getAllByRole("combobox");
  fireEvent.change(selects[0]!, { target: { value: "full_name" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => assert.equal(saveCalls, 1));
});

test("changed mapping with downstream artifacts can require reset confirmation", async () => {
  lastSaveResult = {
    ok: false,
    message: "Reset required",
    resetRequired: true,
    impact: {
      mappingChanged: true,
      resetRequired: true,
      sourceLeadEventsToRemove: 2,
      simulationArtifactsToRemove: 1,
      deliveredRows: 0,
      destinationWillBePreserved: true,
      changeSummary: {
        remappedColumns: 1,
        toPreserveColumns: 0,
        toIgnoreColumns: 0,
        missingRequired: 0,
      },
    },
  };
  renderEditor({ mappingConfirmed: true, initialMode: "edit", hasDownstreamArtifacts: true });
  const selects = screen.getAllByRole("combobox");
  fireEvent.change(selects[0]!, { target: { value: "full_name" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    assert.ok(screen.getByText(/Apply mapping changes and rebuild normalized rows/i))
  );
});
