import assert from "node:assert/strict";
import test from "node:test";
import type { CompanySheetsDestination } from "@prisma/client";

import { presentCompanySheetsDestination, presentCompanySheetsPortal } from "./company-sheets-destination.service.js";

function row(writeReadiness: string): CompanySheetsDestination {
  return {
    clientAccountId: "alex_gross",
    spreadsheetId: "sheet_readiness",
    spreadsheetTitle: "Existing workbook",
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet_readiness/edit",
    worksheetId: 0,
    worksheetTitle: "VET Web Form",
    controlBasis: "approved_shared_drive",
    accessStatus: "readable",
    accessCheckedAt: null,
    writeReadiness,
    intendedRecipientEmail: null,
    destinationRevision: 6,
  } as CompanySheetsDestination;
}

test("destination responses report the stored write readiness", () => {
  const verified = presentCompanySheetsDestination(row("verified"), null);
  assert.equal(verified.writeReadiness, "verified");
  assert.equal(verified.deliveryExecution, "disabled");
  assert.equal(verified.liveDeliveryEnabled, false);
  assert.equal(verified.enabled, false);
  assert.equal(presentCompanySheetsPortal(verified).writeReadiness, "verified");

  const unverified = presentCompanySheetsDestination(row("not_verified"), null);
  assert.equal(unverified.writeReadiness, "not_verified");
  assert.equal(presentCompanySheetsPortal(unverified).writeReadiness, "not_verified");
});
