import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function body(source: string, name: string): string {
  const marker = `export async function ${name}`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, name);
  const rest = source.slice(start + marker.length);
  const next = rest.search(/\n(?:export |async function |function )/);
  return source.slice(start, next === -1 ? undefined : start + marker.length + next);
}

const destination = readFileSync(new URL("./company-sheets-destination.service.ts", import.meta.url), "utf8");
const setup = readFileSync(new URL("./company-sheets-setup.service.ts", import.meta.url), "utf8");
const oauth = readFileSync(new URL("./company-google-oauth.service.ts", import.meta.url), "utf8");
const tabs = readFileSync(new URL("../company-sheets-delivery/company-sheets-tab-contract.service.ts", import.meta.url), "utf8");
const dispatch = readFileSync(new URL("../company-sheets-dispatch/company-sheets-dispatch.service.ts", import.meta.url), "utf8");

test("discovery reads do not create files or change a destination", () => {
  const reads = [
    body(oauth, "getCompanyGoogleOAuthStatus"),
    body(destination, "getCompanySheetsDestinationForClient"),
    body(destination, "resolveCompanySpreadsheetForClient"),
    body(destination, "resolveCompanyClientFolder"),
    body(setup, "listCompanyClientSpreadsheets"),
    body(setup, "reviewCompanySheetsColumnMapping"),
    body(tabs, "listCompanySheetsTabContracts"),
    body(dispatch, "getCompanySheetsDispatchStatus"),
  ];
  for (const source of reads) {
    assert.equal(source.includes(".update("), false, source.slice(0, 80));
    assert.equal(source.includes(".create("), false, source.slice(0, 80));
    assert.equal(source.includes(".delete("), false, source.slice(0, 80));
    assert.equal(source.includes("createCompanyDriveFile"), false, source.slice(0, 80));
    assert.equal(source.includes("values.append"), false, source.slice(0, 80));
    assert.equal(source.includes("persistContract"), false, source.slice(0, 80));
  }
});

test("existing writers can change operations even when a delivery flag is off", () => {
  assert.match(body(setup, "probeCompanySheetWritePermission"), /companySheetsDestination\.update/);
  assert.match(body(destination, "testCompanySheetAccessForClient"), /updateCompanySheetsAccess/);
  const save = body(destination, "saveCompanySheetsDestinationForClient");
  assert.match(save, /campaignDispatchEnabled/);
  assert.match(save, /saveCompanySheetsDestination\(/);
  assert.match(body(destination, "createCompanySpreadsheetForClient"), /placeNamedFile/);
  assert.match(body(destination, "ensureCompanyClientFolder"), /prepareCompanyClientFolder/);
  assert.match(body(setup, "prepareCompanyClientFolder"), /claimFolderCreate/);
  assert.match(body(tabs, "inspectCompanySheetsTabs"), /persistContract/);
  assert.match(body(tabs, "bindCompanySheetsTab"), /persistContract/);
  assert.match(body(tabs, "createMissingCompanySheetsTab"), /addSpreadsheetSheet/);
  assert.match(body(dispatch, "setCompanySheetsDispatchActivation"), /companySheetsDestination\.update/);
  assert.match(body(dispatch, "processDueCompanySheetsDispatches"), /handleClaimedIntent/);
});
