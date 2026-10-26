import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  isCompanyGoogleSheetsDispatchEnabled,
  isCompanyGoogleSheetsExecutionEnabled,
} from "../../lib/company-google-sheets-env.js";

const here = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(here, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}

test("company sheets execution flag defaults off", () => {
  assert.equal(isCompanyGoogleSheetsDispatchEnabled({}), false);
  assert.equal(isCompanyGoogleSheetsDispatchEnabled({ SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED: "false" }), false);
  assert.equal(isCompanyGoogleSheetsDispatchEnabled({ SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED: "true" }), true);
  assert.equal(isCompanyGoogleSheetsExecutionEnabled({}), false);
  assert.equal(
    isCompanyGoogleSheetsExecutionEnabled({ SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED: "false" }),
    false
  );
  assert.equal(
    isCompanyGoogleSheetsExecutionEnabled({ SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED: "TRUE" }),
    true
  );
});

test("delivery writer migration is additive and keeps partial unique indexes", () => {
  const sql = readFileSync(
    join(here, "../../../../../prisma/migrations/20261020200000_company_sheets_delivery_writer/migration.sql"),
    "utf8"
  );
  const foundation = readFileSync(
    join(here, "../../../../../prisma/migrations/20261020183000_company_google_sheets_foundation/migration.sql"),
    "utf8"
  );
  const sheetsUnique = readFileSync(
    join(here, "../../../../../prisma/migrations/20260924120000_google_sheets_destination_unique_v1/migration.sql"),
    "utf8"
  );
  assert.match(sql, /ADD COLUMN "canaryApproved"/);
  assert.match(sql, /CREATE TABLE "CompanySheetsDeliveryJob"/);
  assert.match(sql, /CREATE TABLE "CompanySheetsDeliveryRow"/);
  assert.match(sql, /CREATE TABLE "CompanySheetsWorksheetLock"/);
  assert.match(sql, /CREATE TABLE "CompanySheetsOrderDeliveryEvidence"/);
  assert.match(foundation, /CompanyGoogleConnection_googleUserId_active_key/);
  assert.match(sheetsUnique, /DeliveryTarget_clientAccount_googleSheets_key/);
  assert.equal(sql.includes("DROP "), false);
  assert.equal(sql.includes('DROP INDEX "CompanyGoogleConnection_googleUserId_active_key"'), false);
  assert.equal(sql.includes('DROP INDEX "DeliveryTarget_clientAccount_googleSheets_key"'), false);
  assert.equal(
    /ALTER TABLE "(LeadOrder|LeadAllocation|LeadDeliveryExportPackage|SourceLeadEvent|DeliveryTarget|GoogleAccountConnection)"/.test(
      sql
    ),
    false
  );
});

test("writer stays out of intake, release, inventory, and sharing paths", () => {
  const writer = walk(here).filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"));
  assert.ok(writer.length >= 2);
  for (const path of writer) {
    const source = readFileSync(path, "utf8");
    assert.equal(/[?&]valueInputOption=USER_ENTERED/.test(source), false, path);
    assert.equal(source.includes("permissions.create"), false, path);
    assert.equal(source.includes("type=anyone"), false, path);
    assert.equal(source.includes("markSpreadsheetDelivered"), false, path);
    assert.equal(source.includes("LeadAllocation"), false, path);
    assert.equal(source.includes("bullmq"), false, path);
    assert.equal(source.includes("deliverLive"), false, path);
  }
  const service = readFileSync(join(here, "company-sheets-delivery.service.ts"), "utf8");
  assert.equal(service.includes("neutralizeSpreadsheetCell"), false);
  assert.match(service, /valueInputOption=RAW|appendSheetValues/);
  assert.match(service, /append_outcome_unknown/);
  assert.match(service, /append_outcome_unresolved/);
  const authority = readFileSync(join(here, "company-sheets-aged-authority.ts"), "utf8");
  assert.match(authority, /if \(!packageRow\.spreadsheetDeliveredAt\) return \{ ok: false, code: "package_not_released" \}/);
  assert.equal(authority.includes("spreadsheetDeliveredAt:"), false);
  assert.equal(authority.includes("markSpreadsheetDelivered"), false);
  const contractSql = readFileSync(
    join(here, "../../../../../prisma/migrations/20261020213000_company_sheets_tab_contracts/migration.sql"),
    "utf8"
  );
  assert.match(contractSql, /CREATE TABLE "CompanySheetsTabContract"/);
  assert.equal(contractSql.includes("DROP "), false);
  const http = readFileSync(join(here, "company-sheets-values-http.ts"), "utf8");
  assert.match(http, /valueInputOption=RAW/);
  assert.match(http, /USER_ENTERED/);
  assert.match(http, /drive\.googleapis\.com/);
  const dispatchSql = readFileSync(
    join(here, "../../../../../prisma/migrations/20261020233000_company_sheets_dispatch_intent/migration.sql"),
    "utf8"
  );
  assert.match(dispatchSql, /CREATE TABLE "CompanySheetsDispatchIntent"/);
  assert.match(dispatchSql, /ADD COLUMN "campaignDispatchEnabled"/);
  assert.equal(dispatchSql.includes("DROP "), false);
  const executeStart = service.indexOf("export async function executeCompanySheetsDeliveryJob");
  const executeBody = service.slice(executeStart, executeStart + 900);
  assert.match(executeBody, /executionOff\(env\)/);
  assert.equal(executeBody.includes("scheduleWithoutExecution"), false);
  const pilot = readFileSync(join(apiSrc, "services/company-sheets-dispatch/company-sheets-campaign-pilot.ts"), "utf8");
  assert.equal(pilot.includes("trackCampaignInventory"), false);
  assert.equal(pilot.includes("enqueueMeta"), false);
  assert.equal(pilot.includes("runRoutingDryRun"), false);
  assert.equal(pilot.includes("runManualBulkImportRoutingDryRun"), false);
  assert.equal(pilot.includes("permissions.create"), false);
  assert.equal(pilot.includes("saveLifecycleEvent"), false);
  assert.match(pilot, /COMPANY_SHEETS_INTERNAL_TEST_CLIENT/);
  assert.match(pilot, /pilot_not_armed/);
  assert.match(pilot, /allowTestClient/);
  const pilotRoute = readFileSync(join(apiSrc, "routes/company-sheets-delivery.ts"), "utf8");
  assert.match(pilotRoute, /internal-test\/campaign-pilot/);
  assert.equal(pilotRoute.includes("allowTestClient"), false);
  const isolation = readFileSync(
    join(apiSrc, "services/company-sheets-dispatch/company-sheets-pilot-isolation.ts"),
    "utf8"
  );
  assert.equal(isolation.includes("company-sheets-delivery"), false);
  assert.match(isolation, /companySheetsInternalPilotLeadExclusion/);
  const shadow = readFileSync(join(apiSrc, "services/fulfillment-shadow/shadow-processor.service.ts"), "utf8");
  assert.match(shadow, /isCompanySheetsInternalPilotLead/);
  assert.match(shadow, /companySheetsInternalPilotLeadExclusion/);
  const workerMain = readFileSync(join(here, "../../../../worker/src/worker.ts"), "utf8");
  assert.match(workerMain, /COMPANY_SHEETS_DISPATCH_QUEUE/);
  assert.match(workerMain, /processCompanySheetsDispatchJob/);
  const workerProcessor = readFileSync(
    join(here, "../../../../worker/src/processors/company-sheets-dispatch.processor.ts"),
    "utf8"
  );
  assert.match(workerProcessor, /\/admin\/v1\/company-sheets\/internal\/process-dispatch/);
  const record = readFileSync(join(apiSrc, "services/company-sheets-dispatch/company-sheets-dispatch-record.ts"), "utf8");
  assert.equal(record.includes("company-sheets-delivery"), false);
  assert.equal(record.includes("appendSheetValues"), false);
  assert.equal(record.includes("googleapis"), false);
  assert.equal(record.includes("permissions.create"), false);
  assert.equal(record.includes("markSpreadsheetDelivered"), false);
  const dispatchService = readFileSync(
    join(apiSrc, "services/company-sheets-dispatch/company-sheets-dispatch.service.ts"),
    "utf8"
  );
  assert.equal(dispatchService.includes("permissions.create"), false);
  assert.equal(dispatchService.includes("markSpreadsheetDelivered"), false);
  assert.equal(dispatchService.includes("type=anyone"), false);
  const routing = readFileSync(join(apiSrc, "services/source-intake/source-intake-routing-persist.ts"), "utf8");
  assert.equal(routing.includes("company-sheets-delivery"), false);
  assert.match(routing, /prisma\.\$transaction/);
  assert.match(routing, /recordCompanySheetsCampaignIntent/);
  const csvExport = readFileSync(join(apiSrc, "services/ppl-fulfillment/buyer-csv-export.service.ts"), "utf8");
  assert.equal(csvExport.includes("company-sheets-delivery"), false);
  assert.match(csvExport, /recordCompanySheetsAgedIntent/);
  const commitAt = csvExport.indexOf("export async function commitBuyerCsvExport");
  const downloadAt = csvExport.indexOf("export async function getBuyerCsvExportDownload");
  const releaseAt = csvExport.indexOf("export async function markSpreadsheetDelivered");
  assert.equal(csvExport.slice(commitAt, downloadAt).includes("recordCompanySheetsAgedIntent"), false);
  const releaseSlice = csvExport.slice(releaseAt, csvExport.indexOf("async function attachCustomerReleaseNotification"));
  assert.match(releaseSlice, /recordCompanySheetsAgedIntent/);
  assert.match(releaseSlice, /createdAt: now/);
  assert.equal(csvExport.includes("permissions.create"), false);

  for (const path of walk(apiSrc)) {
    if (path.endsWith(".test.ts")) continue;
    if (path.includes(`${join("services", "company-sheets-delivery")}`)) continue;
    if (path.includes(`${join("services", "company-sheets-dispatch")}`)) continue;
    if (path.endsWith(`${join("routes", "company-sheets-delivery.ts")}`)) continue;
    if (path.endsWith(`${join("src", "app.ts")}`)) continue;
    const source = readFileSync(path, "utf8");
    if (path.endsWith(`${join("services", "company-google", "company-sheets-setup.service.ts")}`)) {
      assert.match(source, /company-sheets-campaign-row/);
      assert.equal(source.includes("company-sheets-delivery.service"), false, path);
      assert.equal(source.includes("appendSheetValues"), false, path);
      assert.equal(source.includes("updateSheetValues"), false, path);
      assert.equal(source.includes("permissions.create"), false, path);
      assert.equal(source.includes("markSpreadsheetDelivered"), false, path);
      continue;
    }
    assert.equal(source.includes("company-sheets-delivery"), false, path);
  }
});
