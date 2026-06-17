import assert from "node:assert/strict";
import test from "node:test";
import { translateBulkImportApiError } from "./action-results.ts";
import { deriveWizardStep } from "./wizard-steps.ts";
import { isNavItemActive } from "./nav-active.ts";
import { bulkImportsNavItem, operationsNav } from "@/lib/nav";

test("translateBulkImportApiError maps simulation_required", () => {
  assert.match(translateBulkImportApiError("simulation_required"), /successful simulation/i);
});

test("deriveWizardStep stays on review when no eligible rows", () => {
  const step = deriveWizardStep(
    {
      status: "ready_for_review",
      destinationClientAccountId: "client_a",
      destinationLocationIdGhl: "loc_a",
      wizardStepJson: { step: "review" },
    },
    { eligibleForSimulation: 0 }
  );
  assert.equal(step, "review");
});

test("deriveWizardStep advances to approve only after simulation_complete", () => {
  const step = deriveWizardStep(
    {
      status: "simulation_complete",
      destinationClientAccountId: "client_a",
      destinationLocationIdGhl: "loc_a",
      simulatedRows: 3,
      wizardStepJson: { step: "approve" },
    },
    { eligibleForSimulation: 3, simulatedRows: 3 }
  );
  assert.equal(step, "approve");
});

test("bulk imports path activates only Bulk Imports nav item", () => {
  const items = [...operationsNav, bulkImportsNavItem];
  assert.equal(
    isNavItemActive("/source-intake/imports/new", "/source-intake", items),
    false
  );
  assert.equal(
    isNavItemActive("/source-intake/imports/new", bulkImportsNavItem.href, items),
    true
  );
});

test("source intake path activates only Source Intake Queue", () => {
  const items = [...operationsNav, bulkImportsNavItem];
  assert.equal(isNavItemActive("/source-intake", "/source-intake", items), true);
  assert.equal(
    isNavItemActive("/source-intake/lead-123", "/source-intake", items),
    true
  );
  assert.equal(
    isNavItemActive("/source-intake/imports/abc", bulkImportsNavItem.href, items),
    true
  );
});
