import assert from "node:assert/strict";
import test from "node:test";

import {
  SMS_DISCLOSURE,
  SMS_VERBAL_OPERATOR_EMAILS,
  composeGhlLeadSmsConsentText,
  composeSmsConsentText,
  ghlLeadSmsDisclosureTextIsComplete,
  publicLegalUrl,
  readSmsDisclosure,
  smsDisclosureTextIsComplete,
  smsVerbalOperatorAllowed,
} from "./sms-disclosure.js";

const PRIVACY = "https://policies.lifeagentlaunch.invalid/privacy";
const TERMS = "https://policies.lifeagentlaunch.invalid/terms";

test("legal URLs stay empty until two distinct public https pages are configured", () => {
  assert.equal(publicLegalUrl("https://example.com/privacy"), null);
  assert.equal(publicLegalUrl("http://policies.lifeagentlaunch.invalid/privacy"), null);
  assert.equal(publicLegalUrl("https://user:pass@policies.lifeagentlaunch.invalid/privacy"), null);
  assert.equal(publicLegalUrl("https://127.0.0.1/privacy"), null);
  const missing = readSmsDisclosure({});
  assert.equal(missing.recordable, false);
  assert.equal(missing.privacyPolicyUrl, null);
  assert.equal(missing.termsUrl, null);
  assert.equal(missing.text, null);
  assert.equal(missing.businessName, "Life Agent Launch");
  assert.equal(missing.rates, "Message and data rates may apply.");
  const same = readSmsDisclosure({
    SA360_SMS_PRIVACY_POLICY_URL: PRIVACY,
    SA360_SMS_TERMS_URL: PRIVACY,
  });
  assert.equal(same.recordable, false);
});

test("a complete disclosure names the program, frequency, rates, STOP, HELP, and both links", () => {
  const view = readSmsDisclosure({
    SA360_SMS_PRIVACY_POLICY_URL: `${PRIVACY}/`,
    SA360_SMS_TERMS_URL: TERMS,
  });
  assert.equal(view.recordable, true);
  assert.equal(view.version, "ghl-lead-sms-v1");
  assert.equal(view.privacyPolicyUrl, PRIVACY);
  assert.equal(view.text, composeGhlLeadSmsConsentText({ privacyPolicyUrl: PRIVACY, termsUrl: TERMS }));
  assert.equal(ghlLeadSmsDisclosureTextIsComplete(view.text ?? ""), true);
  assert.equal(smsDisclosureTextIsComplete(view.text ?? ""), false);
  assert.match(view.text ?? "", /lead is received in your GoHighLevel account/);
  const historical = composeSmsConsentText({ privacyPolicyUrl: PRIVACY, termsUrl: TERMS });
  assert.equal(smsDisclosureTextIsComplete(historical), true);
  assert.match(historical, /operational SA360 delivery notifications/);
  assert.equal(view.text?.includes(SMS_DISCLOSURE.frequency), true);
  assert.equal(view.text?.includes(SMS_DISCLOSURE.stop), true);
  assert.equal(view.text?.includes(SMS_DISCLOSURE.help), true);
  assert.equal(view.text?.includes("@"), false);
  assert.equal((view.text ?? "").length <= 500, true);
  assert.equal(ghlLeadSmsDisclosureTextIsComplete(`${view.text} extra`), false);
});

test("SMS consent operators stay limited to the named staff mailboxes", () => {
  assert.deepEqual(SMS_VERBAL_OPERATOR_EMAILS, [
    "matt@lifeagentlaunch.com",
    "alex@lifeagentlaunch.com",
    "aaron@lifeagentlaunch.com",
    "sam@lifeagentlaunch.com",
  ]);
  assert.equal(smsVerbalOperatorAllowed("matt@lifeagentlaunch.com"), true);
  assert.equal(smsVerbalOperatorAllowed("Alex@lifeagentlaunch.com"), true);
  assert.equal(smsVerbalOperatorAllowed(" aaron@lifeagentlaunch.com "), true);
  assert.equal(smsVerbalOperatorAllowed("sam@lifeagentlaunch.com"), true);
  assert.equal(smsVerbalOperatorAllowed("samuel.hebda@gmail.com"), false);
  assert.equal(smsVerbalOperatorAllowed("sam@lifeagentlaunch.com.evil.com"), false);
  assert.equal(smsVerbalOperatorAllowed("pat@lifeagentlaunch.com"), false);
  assert.equal(smsVerbalOperatorAllowed(""), false);
});
