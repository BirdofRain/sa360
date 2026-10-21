import assert from "node:assert/strict";
import test from "node:test";

import { campaignLeadIdentityFromPayload } from "../company-sheets-delivery/company-sheets-delivery.service.js";
import {
  COMPANY_SHEETS_APPROVED_TEST_SPREADSHEET_ID,
  COMPANY_SHEETS_APPROVED_TEST_TAB_TITLE,
  COMPANY_SHEETS_INTERNAL_TEST_CLIENT,
  COMPANY_SHEETS_PILOT_EMAIL,
  COMPANY_SHEETS_PILOT_PHONE,
  companySheetsPilotSpreadsheetAllowed,
  decideCompanySheetsPilotRoute,
  parseCompanySheetsCampaignPilotBody,
} from "./company-sheets-campaign-pilot.js";

test("the real internal test client arms only the approved spreadsheet and Campaign Leads tab", () => {
  assert.equal(
    companySheetsPilotSpreadsheetAllowed({
      clientAccountId: COMPANY_SHEETS_INTERNAL_TEST_CLIENT,
      spreadsheetId: COMPANY_SHEETS_APPROVED_TEST_SPREADSHEET_ID,
      worksheetTitle: COMPANY_SHEETS_APPROVED_TEST_TAB_TITLE,
    }),
    true
  );
  assert.equal(
    companySheetsPilotSpreadsheetAllowed({
      clientAccountId: COMPANY_SHEETS_INTERNAL_TEST_CLIENT,
      spreadsheetId: "another-sheet",
      worksheetTitle: COMPANY_SHEETS_APPROVED_TEST_TAB_TITLE,
    }),
    false
  );
  assert.equal(
    companySheetsPilotSpreadsheetAllowed({
      clientAccountId: COMPANY_SHEETS_INTERNAL_TEST_CLIENT,
      spreadsheetId: COMPANY_SHEETS_APPROVED_TEST_SPREADSHEET_ID,
      worksheetTitle: "Sheet1",
    }),
    false
  );
  assert.equal(
    companySheetsPilotSpreadsheetAllowed({
      clientAccountId: "cspilot_local",
      spreadsheetId: "sheetPilotlocal",
      worksheetTitle: "Campaign Leads",
    }),
    true
  );
});

test("campaign pilot body accepts only a reserved idempotency key", () => {
  assert.equal(parseCompanySheetsCampaignPilotBody({ idempotencyKey: "pilot-20261021a" }).ok, true);
  assert.equal(parseCompanySheetsCampaignPilotBody({ idempotencyKey: "real-lead" }).ok, false);
  assert.equal(parseCompanySheetsCampaignPilotBody({ idempotencyKey: "pilot-20261021a", clientAccountId: "other" }).ok, false);
  assert.equal(parseCompanySheetsCampaignPilotBody({ idempotencyKey: "pilot-20261021a", email: "a@b.c" }).ok, false);
  assert.equal(parseCompanySheetsCampaignPilotBody(["pilot-20261021a"]).ok, false);
  assert.equal(parseCompanySheetsCampaignPilotBody(null).ok, false);
});

test("campaign pilot route refuses another client and keeps an unmatched synthetic lead on the operator path", () => {
  const elsewhere = decideCompanySheetsPilotRoute({
    clientAccountId: "company_sheets_internal_test",
    ruleMatch: {
      matched: true,
      confidence: "high",
      matchType: "campaign_id",
      matchedRuleId: "rule-1",
      destinationClientAccountId: "real-client",
      destinationSubaccountIdGhl: "loc",
      reason: "matched",
    },
    associationClientAccountId: null,
    associationSubaccountIdGhl: "",
    associationReason: null,
  });
  assert.equal(elsewhere.ok, false);
  if (!elsewhere.ok) assert.equal(elsewhere.code, "pilot_routed_elsewhere");

  const looseElsewhere = decideCompanySheetsPilotRoute({
    clientAccountId: "company_sheets_internal_test",
    ruleMatch: {
      matched: true,
      confidence: "low",
      matchType: "keyword_fallback",
      matchedRuleId: "rule-2",
      destinationClientAccountId: "real-client",
      reason: "keyword",
    },
    associationClientAccountId: null,
    associationSubaccountIdGhl: "",
    associationReason: null,
  });
  assert.equal(looseElsewhere.ok, false);

  const associationElsewhere = decideCompanySheetsPilotRoute({
    clientAccountId: "company_sheets_internal_test",
    ruleMatch: { matched: false, confidence: "none", reason: "none" },
    associationClientAccountId: "real-client",
    associationSubaccountIdGhl: "loc",
    associationReason: "association",
  });
  assert.equal(associationElsewhere.ok, false);

  const unmatched = decideCompanySheetsPilotRoute({
    clientAccountId: "company_sheets_internal_test",
    ruleMatch: { matched: false, confidence: "none", reason: "none" },
    associationClientAccountId: null,
    associationSubaccountIdGhl: "",
    associationReason: null,
  });
  assert.equal(unmatched.ok, true);
  if (!unmatched.ok) return;
  assert.equal(unmatched.routingAuthority, "operator_selected_destination");
  assert.equal(unmatched.matchType, "internal_sheets_pilot");
  assert.equal(unmatched.matchedRuleId, null);

  const canonical = decideCompanySheetsPilotRoute({
    clientAccountId: "company_sheets_internal_test",
    ruleMatch: {
      matched: true,
      confidence: "high",
      matchType: "campaign_id",
      matchedRuleId: "rule-self",
      destinationClientAccountId: "company_sheets_internal_test",
      destinationSubaccountIdGhl: "",
      reason: "self",
    },
    associationClientAccountId: "real-client",
    associationSubaccountIdGhl: "loc",
    associationReason: "ignored because the exact rule wins",
  });
  assert.equal(canonical.ok, true);
  if (!canonical.ok) return;
  assert.equal(canonical.routingAuthority, "campaign_routing_rule");
  assert.equal(canonical.matchedRuleId, "rule-self");
});

test("campaign lead identity reads nested intake contact without dropping flat fields", () => {
  const nested = campaignLeadIdentityFromPayload({
    contact: {
      first_name: "Synthetic",
      last_name: "Sheets",
      email: COMPANY_SHEETS_PILOT_EMAIL,
      phone_e164: COMPANY_SHEETS_PILOT_PHONE,
    },
  });
  assert.equal(nested.fullName, "Synthetic Sheets");
  assert.equal(nested.email, COMPANY_SHEETS_PILOT_EMAIL);
  assert.equal(nested.phone, COMPANY_SHEETS_PILOT_PHONE);

  const flat = campaignLeadIdentityFromPayload({
    first_name: "Ada",
    last_name: "Lovelace",
    email: "ada@example.com",
    phone: "=15551212",
    contact: { email: "other@example.com", phone_e164: "+15550000" },
  });
  assert.equal(flat.fullName, "Ada Lovelace");
  assert.equal(flat.email, "ada@example.com");
  assert.equal(flat.phone, "=15551212");
});
