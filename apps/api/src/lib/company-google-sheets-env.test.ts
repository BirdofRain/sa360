import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompanyAdminRedirect,
  deriveCompanySheetsControl,
  isCompanyGoogleOAuthEnabled,
  isCompanyGoogleSheetsEnabled,
  listUntrustedDestinationFields,
  neutralizeSpreadsheetCell,
  parseCompanyDriveFolderRef,
  parseIntendedRecipientEmail,
  parseSafeCompanyAdminReturnTo,
  projectCompanySheetsSharing,
} from "./company-google-sheets-env.js";
import { isGoogleSheetsLf2PlanningExcluded } from "./google-sheets-env.js";

test("company Google flags are deny-by-default and independent", () => {
  assert.equal(isCompanyGoogleOAuthEnabled({}), false);
  assert.equal(isCompanyGoogleSheetsEnabled({ SA360_COMPANY_GOOGLE_OAUTH_ENABLED: "true" }), false);
  assert.equal(isCompanyGoogleOAuthEnabled({ SA360_COMPANY_GOOGLE_OAUTH_ENABLED: " TRUE " }), true);
  assert.equal(isCompanyGoogleSheetsEnabled({ SA360_COMPANY_GOOGLE_SHEETS_ENABLED: "true" }), true);
});

test("company control ignores a browser ownership claim and requires server proof", () => {
  assert.deepEqual(deriveCompanySheetsControl({ creationMarker: false, driveOwnerMatch: null }), {
    ok: false,
    reason: "ownership_unverified",
  });
  assert.deepEqual(deriveCompanySheetsControl({ creationMarker: false, driveOwnerMatch: false }), {
    ok: false,
    reason: "not_company_controlled",
  });
  assert.deepEqual(deriveCompanySheetsControl({ creationMarker: true, driveOwnerMatch: false }), {
    ok: false,
    reason: "not_company_controlled",
  });
  assert.deepEqual(deriveCompanySheetsControl({ creationMarker: false, driveOwnerMatch: true }), {
    ok: true,
    controlBasis: "drive_owner_verified",
  });
  assert.deepEqual(deriveCompanySheetsControl({ creationMarker: true, driveOwnerMatch: null }), {
    ok: true,
    controlBasis: "company_created",
  });
  assert.deepEqual(deriveCompanySheetsControl({ creationMarker: true, driveOwnerMatch: true }), {
    ok: true,
    controlBasis: "company_created",
  });
});

test("untrusted destination fields are named so routes do not persist them", () => {
  const found = listUntrustedDestinationFields({
    spreadsheetId: "abc",
    createdBySa360: true,
    ownedByCompany: true,
    enabled: true,
  });
  assert.ok(found.includes("createdBySa360"));
  assert.ok(found.includes("ownedByCompany"));
  assert.ok(found.includes("enabled"));
});

test("folder refs accept a Drive folder URL or raw id and reject other hosts", () => {
  assert.equal(
    parseCompanyDriveFolderRef("https://drive.google.com/drive/folders/1abcdefghijklmnopqrstuvwxyz").ok,
    true
  );
  assert.equal(parseCompanyDriveFolderRef("1abcdefghijklmnopqrstuvwxyz").ok, true);
  assert.equal(parseCompanyDriveFolderRef("https://evil.example/drive/folders/1abcdefghijklmnopqrstuvwxyz").ok, false);
  assert.equal(parseCompanyDriveFolderRef("javascript:alert(1)").ok, false);
});

test("recipient email is optional and sharing stays unapplied", () => {
  assert.deepEqual(parseIntendedRecipientEmail(" Buyer@Example.com "), {
    ok: true,
    email: "buyer@example.com",
  });
  assert.equal(parseIntendedRecipientEmail("not an email").ok, false);
  const missing = projectCompanySheetsSharing(null);
  assert.equal(missing.missingRecipientPolicy, true);
  assert.equal(missing.anyoneWithLink, false);
  assert.equal(missing.public, false);
  assert.equal(missing.portalLinkGrantsGoogleAccess, false);
  assert.equal(missing.clientGooglePermission, "not_granted");
  const recorded = projectCompanySheetsSharing("buyer@example.com");
  assert.equal(recorded.status, "intended_recipient_recorded_not_applied");
  assert.equal(recorded.missingRecipientPolicy, false);
  assert.equal(recorded.anyoneWithLink, false);
});

test("spreadsheet cells that look like formulas are neutralized as data", () => {
  assert.equal(neutralizeSpreadsheetCell("=HYPERLINK(\"https://evil\")"), "'=HYPERLINK(\"https://evil\")");
  assert.equal(neutralizeSpreadsheetCell("  +1"), "'  +1");
  assert.equal(neutralizeSpreadsheetCell("-2"), "'-2");
  assert.equal(neutralizeSpreadsheetCell("@cmd"), "'@cmd");
  assert.equal(neutralizeSpreadsheetCell("Ada Lovelace"), "Ada Lovelace");
});

test("admin OAuth return paths stay on client admin pages", () => {
  assert.equal(parseSafeCompanyAdminReturnTo(null), "/clients");
  assert.equal(parseSafeCompanyAdminReturnTo("/clients/acme_1/google-sheets"), "/clients/acme_1/google-sheets");
  assert.equal(parseSafeCompanyAdminReturnTo("/portal/account"), null);
  assert.equal(parseSafeCompanyAdminReturnTo("https://evil.example/clients"), null);
  assert.equal(parseSafeCompanyAdminReturnTo("/clients/acme_1/../admin"), null);
  const redirect = buildCompanyAdminRedirect(
    "https://admin.example",
    "/clients/acme_1/google-sheets",
    "connected"
  );
  assert.equal(
    redirect,
    "https://admin.example/clients/acme_1/google-sheets?companyGoogle=connected"
  );
});

test("company sheets adapter key stays out of LF2 planning", () => {
  assert.equal(isGoogleSheetsLf2PlanningExcluded("google_sheets.v1"), true);
  assert.equal(isGoogleSheetsLf2PlanningExcluded("google_sheets.company.v1"), true);
  assert.equal(isGoogleSheetsLf2PlanningExcluded("ghl.crm.v1"), false);
});
