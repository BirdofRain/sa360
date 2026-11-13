import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SMS_CONSENT_TEXT, SMS_CONSENT_VERSION, smsConsentTextIsCanonical } from "./sms-consent.js";
import {
  canTransitionNotice,
  providerStatusConfirmsDelivery,
  providerStatusIsStorable,
} from "./notice-status.js";

const LEAD = ["LeadFirstNameZz", "lead.person@example.com", "+19995550199", "19 Example Lane"];

test("notice transitions keep provider acceptance short of delivery", () => {
  assert.equal(canTransitionNotice("pending", "sending"), true);
  assert.equal(canTransitionNotice("sending", "provider_accepted"), true);
  assert.equal(canTransitionNotice("sending", "uncertain"), true);
  assert.equal(canTransitionNotice("sending", "sent"), false);
  assert.equal(canTransitionNotice("provider_accepted", "sent"), true);
  assert.equal(canTransitionNotice("provider_accepted", "sending"), false);
  assert.equal(canTransitionNotice("uncertain", "sending"), false);
  assert.equal(canTransitionNotice("uncertain", "provider_accepted"), true);
  assert.equal(canTransitionNotice("sent", "failed"), false);
  assert.equal(canTransitionNotice("suppressed", "pending"), false);
  assert.equal(providerStatusConfirmsDelivery("accepted"), false);
  assert.equal(providerStatusConfirmsDelivery("queued"), false);
  assert.equal(providerStatusConfirmsDelivery("delivered"), true);
  assert.equal(providerStatusConfirmsDelivery("read"), true);
  assert.equal(providerStatusIsStorable("accepted"), true);
  assert.equal(providerStatusIsStorable("LeadFirstNameZz"), false);
});

test("canonical SMS consent contains STOP language and no consumer lead PII", () => {
  assert.equal(smsConsentTextIsCanonical(SMS_CONSENT_VERSION, SMS_CONSENT_TEXT), true);
  assert.equal(smsConsentTextIsCanonical(SMS_CONSENT_VERSION, `${SMS_CONSENT_TEXT} extra`), false);
  assert.equal(SMS_CONSENT_TEXT.includes("Reply STOP to opt out."), true);
  for (const secret of LEAD) assert.equal(SMS_CONSENT_TEXT.includes(secret), false);
  const migration = readFileSync(
    new URL("../../../../../prisma/migrations/20261113223000_external_webhook_notification_receipts/migration.sql", import.meta.url),
    "utf8"
  );
  assert.equal(migration.includes(SMS_CONSENT_TEXT), true);
  assert.equal(migration.includes(SMS_CONSENT_VERSION), true);
});
