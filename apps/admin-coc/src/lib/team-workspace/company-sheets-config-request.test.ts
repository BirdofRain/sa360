import assert from "node:assert/strict";
import test from "node:test";

import { isCompanySheetsConfigRequestEnabled } from "./company-sheets-config-request-env.ts";
import {
  buildCompanySheetsConfigSubmitBody,
  companySheetsConfigRequestErrorMessage,
  parseCompanySheetsConfigHead,
  parseCompanySheetsConfigSaveResult,
  parseCompanySpreadsheetRef,
  presentCompanySheetsConfigProgress,
  reviewCompanySheetsConfig,
  sameCompanySheetsConfigSubmitBody,
  type CompanySheetsConfigContext,
  type CompanySheetsConfigHead,
} from "./company-sheets-config-request.ts";

const SHEET = "1a2b3c4d5e6f7g8h";
const OTHER = "1a2b3c4d5e6f7g8z";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

test("the configuration request flag accepts only the exact string true", () => {
  assert.equal(isCompanySheetsConfigRequestEnabled({}), false);
  assert.equal(isCompanySheetsConfigRequestEnabled({ SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED: " true " }), true);
  assert.equal(isCompanySheetsConfigRequestEnabled({ SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED: "TRUE" }), false);
  assert.equal(isCompanySheetsConfigRequestEnabled({ SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED: "1" }), false);
  assert.equal(isCompanySheetsConfigRequestEnabled({ SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED: "yes" }), false);
});

test("a Google Sheets link and its spreadsheet id are the same file", () => {
  const id = parseCompanySpreadsheetRef(SHEET);
  const link = parseCompanySpreadsheetRef(`https://docs.google.com/spreadsheets/d/${SHEET}/edit?usp=sharing#gid=101`);
  const account = parseCompanySpreadsheetRef(`https://docs.google.com/spreadsheets/u/0/d/${SHEET}/edit`);
  assert.equal(id.ok && link.ok && account.ok && id.spreadsheetId === link.spreadsheetId && id.spreadsheetId === account.spreadsheetId, true);
  assert.equal(parseCompanySpreadsheetRef("http://docs.google.com/spreadsheets/d/" + SHEET).ok, false);
  assert.equal(parseCompanySpreadsheetRef("https://example.com/spreadsheets/d/" + SHEET).ok, false);
  assert.equal(parseCompanySpreadsheetRef("sheet-1").ok, false);
  assert.equal(parseCompanySpreadsheetRef("").ok, false);
});

test("the first request can be submitted only after this session reads a grid worksheet", () => {
  const ready = reviewCompanySheetsConfig({ context: context(), head: head() });
  assert.equal(ready.canSubmit, true);
  assert.equal(ready.sessionVerified, true);
  assert.equal(ready.activeDelivery, false);
  const body = buildCompanySheetsConfigSubmitBody({
    requestId: REQUEST_ID,
    head: head(),
    spreadsheetId: `https://docs.google.com/spreadsheets/d/${SHEET}/edit`,
    worksheetId: 101,
  });
  assert.deepEqual(body, {
    requestId: REQUEST_ID,
    expectedRevision: 0,
    expectedDestinationRevision: null,
    spreadsheetId: SHEET,
    worksheetId: 101,
  });
  assert.equal(body && "spreadsheetTitle" in body, false);
  assert.equal(presentCompanySheetsConfigProgress(head()).find((step) => step.id === "request_saved")?.state, "waiting");
});

test("an active destination warns and still allows an intended request", () => {
  const activeHead = head({
    operationalDestination: { exists: true, destinationRevision: 4, campaignDispatchEnabled: true, agedDispatchEnabled: false },
  });
  const review = reviewCompanySheetsConfig({
    context: context({
      discoveryDestination: { exists: true, destinationRevision: 4, campaignDispatchEnabled: true, agedDispatchEnabled: false },
    }),
    head: activeHead,
  });
  assert.equal(review.canSubmit, true);
  assert.equal(review.activeDelivery, true);
  assert.match(review.activeDeliveryWarning ?? "", /does not change that destination/i);
  const body = buildCompanySheetsConfigSubmitBody({
    requestId: REQUEST_ID,
    head: activeHead,
    spreadsheetId: SHEET,
    worksheetId: 101,
  });
  assert.equal(body?.expectedDestinationRevision, 4);
  assert.equal(body?.expectedRevision, 0);
});

test("a worksheet from another spreadsheet and a non-grid tab cannot be submitted", () => {
  const foreign = reviewCompanySheetsConfig({
    context: context({
      spreadsheetId: OTHER,
      verification: verification(SHEET),
    }),
    head: head(),
  });
  assert.equal(foreign.canSubmit, false);
  assert.match(foreign.blockers.join(" "), /another spreadsheet/i);
  const chart = reviewCompanySheetsConfig({
    context: context({
      worksheetId: 303,
      verification: verification(SHEET, [{ worksheetId: 303, title: "Chart", sheetType: "CHART" }]),
    }),
    head: head(),
  });
  assert.equal(chart.canSubmit, false);
  assert.match(chart.blockers.join(" "), /not a grid tab/i);
  const missing = reviewCompanySheetsConfig({
    context: context({ worksheetId: 404 }),
    head: head(),
  });
  assert.equal(missing.canSubmit, false);
  assert.match(missing.blockers.join(" "), /not on this spreadsheet/i);
  const unselected = reviewCompanySheetsConfig({
    context: context({ worksheetId: null }),
    head: head(),
  });
  assert.match(unselected.blockers.join(" "), /not selected automatically/i);
});

test("company ownership failures and stale revisions stay unstored", () => {
  const owned = reviewCompanySheetsConfig({
    context: context({
      verification: { ...verification(SHEET), ok: false, code: "not_company_controlled", controlBasis: null, worksheets: [] },
    }),
    head: head(),
  });
  assert.equal(owned.sessionVerified, false);
  assert.match(owned.blockers.join(" "), /not company-controlled/i);
  assert.match(companySheetsConfigRequestErrorMessage("spreadsheet_bound_to_other_client"), /another client/i);
  assert.match(companySheetsConfigRequestErrorMessage("revision_conflict"), /Reload/i);
  assert.match(companySheetsConfigRequestErrorMessage("destination_stale"), /operational destination changed/i);
  assert.match(companySheetsConfigRequestErrorMessage("forbidden"), /Portal access and observer access/i);
  const stale = reviewCompanySheetsConfig({
    context: context({
      discoveryDestination: { exists: true, destinationRevision: 5, campaignDispatchEnabled: false, agedDispatchEnabled: false },
    }),
    head: head({
      operationalDestination: { exists: true, destinationRevision: 4, campaignDispatchEnabled: false, agedDispatchEnabled: false },
    }),
  });
  assert.match(stale.blockers.join(" "), /does not match the configuration request/i);
});

test("progress follows the stored request and a stored request is not verification", () => {
  const storedHead = head({
    revision: 2,
    configuration: {
      requestId: REQUEST_ID,
      revision: 2,
      spreadsheetId: SHEET,
      worksheetId: 101,
      spreadsheetTitle: "Alex leads",
      worksheetTitle: "Campaign Leads",
      controlBasis: "approved_shared_drive",
      controlCheckedAt: "2026-11-10T15:00:00.000Z",
      expectedDestinationRevision: null,
      createdAt: "2026-11-10T15:00:00.000Z",
    },
  });
  const steps = presentCompanySheetsConfigProgress(storedHead);
  assert.equal(steps.find((step) => step.id === "request_saved")?.state, "complete");
  assert.equal(steps.find((step) => step.id === "awaiting_application")?.state, "current");
  const review = reviewCompanySheetsConfig({ context: context({ verification: null, worksheetId: null, spreadsheetId: null }), head: storedHead });
  assert.equal(review.sessionVerified, false);
  assert.equal(review.canSubmit, false);
  assert.match(review.controlDetail, /stored request is not verification/i);
});

test("the head and save parsers reject an operational write", () => {
  const saved = parseCompanySheetsConfigSaveResult({
    ...successBody(),
    destinationUpdated: true,
  });
  assert.equal(saved, null);
  const headValue = parseCompanySheetsConfigHead({
    ...headBody(),
    deliveryArmed: true,
  });
  assert.equal(headValue, null);
  const ok = parseCompanySheetsConfigHead(headBody());
  assert.equal(ok?.revision, 2);
  assert.equal(ok?.operationalDestination.destinationRevision, 4);
  assert.equal(ok?.configuration?.requestId, REQUEST_ID);
});

test("the same request payload matches and a worksheet change does not", () => {
  const left = buildCompanySheetsConfigSubmitBody({ requestId: REQUEST_ID, head: head(), spreadsheetId: SHEET, worksheetId: 101 });
  const right = buildCompanySheetsConfigSubmitBody({
    requestId: REQUEST_ID,
    head: head(),
    spreadsheetId: `https://docs.google.com/spreadsheets/d/${SHEET}/edit`,
    worksheetId: 101,
  });
  assert.equal(left != null && right != null && sameCompanySheetsConfigSubmitBody(left, right), true);
  const changed = buildCompanySheetsConfigSubmitBody({ requestId: REQUEST_ID, head: head(), spreadsheetId: SHEET, worksheetId: 202 });
  assert.equal(left != null && changed != null && sameCompanySheetsConfigSubmitBody(left, changed), false);
});

function boundary() {
  return {
    operationalWrite: false,
    destinationUpdated: false,
    dispatchChanged: false,
    driveChanged: false,
    tabContractChanged: false,
    columnMapPublished: false,
    deliveryArmed: false,
    routingChanged: false,
    fulfillmentChanged: false,
  };
}

function verification(
  spreadsheetId: string,
  worksheets: Array<{ worksheetId: number; title: string; sheetType: string | null }> = [
    { worksheetId: 101, title: "Campaign Leads", sheetType: "GRID" },
    { worksheetId: 202, title: "Notes", sheetType: "GRID" },
  ]
) {
  return {
    spreadsheetId,
    ok: true,
    code: null,
    title: "Alex leads",
    controlBasis: "approved_shared_drive",
    worksheets,
  };
}

function context(overrides: Partial<CompanySheetsConfigContext> = {}): CompanySheetsConfigContext {
  return {
    connection: {
      connected: true,
      reconnectRequired: false,
      status: "connected",
      googleEmail: "sheets@lifeagentlaunch.com",
      sheetsSetupAvailable: true,
      approvedParentStored: true,
    },
    folderStatus: "recorded",
    folderDetail: "Recorded folder “Alex Gross” is inside approved company storage.",
    spreadsheetId: SHEET,
    spreadsheetInputInvalid: false,
    worksheetId: 101,
    verification: verification(SHEET),
    discoveryDestination: { exists: false, destinationRevision: null, campaignDispatchEnabled: false, agedDispatchEnabled: false },
    ...overrides,
  };
}

function head(overrides: Partial<CompanySheetsConfigHead> = {}): CompanySheetsConfigHead {
  return {
    clientAccountId: "alex_gross",
    revision: 0,
    operationalDestination: { exists: false, destinationRevision: null, campaignDispatchEnabled: false, agedDispatchEnabled: false },
    configuration: null,
    ...overrides,
  };
}

function headBody() {
  return {
    ...boundary(),
    ok: true,
    clientAccountId: "alex_gross",
    revision: 2,
    operationalDestination: { exists: true, destinationRevision: 4, campaignDispatchEnabled: true, agedDispatchEnabled: false },
    configuration: {
      requestId: REQUEST_ID,
      revision: 2,
      spreadsheetId: SHEET,
      worksheetId: 101,
      spreadsheetTitle: "Alex leads",
      worksheetTitle: "Campaign Leads",
      controlBasis: "approved_shared_drive",
      controlCheckedAt: "2026-11-10T15:00:00.000Z",
      expectedDestinationRevision: 4,
      createdAt: "2026-11-10T15:00:00.000Z",
    },
  };
}

function successBody() {
  return {
    ...boundary(),
    ok: true,
    status: "stored",
    replayed: false,
    requestId: REQUEST_ID,
    revision: 1,
    spreadsheetId: SHEET,
    worksheetId: 101,
    spreadsheetTitle: "Alex leads",
    worksheetTitle: "Campaign Leads",
    controlBasis: "approved_shared_drive",
    controlCheckedAt: "2026-11-10T15:00:00.000Z",
    expectedDestinationRevision: null,
    operationalDestination: { exists: false, destinationRevision: null, campaignDispatchEnabled: false, agedDispatchEnabled: false },
  };
}
