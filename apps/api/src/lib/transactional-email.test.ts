import assert from "node:assert/strict";
import test from "node:test";

import { isTransactionalEmailConfigured, sendTransactionalEmail } from "./transactional-email.js";

test("isTransactionalEmailConfigured requires api key and from address", (t) => {
  const prevKey = process.env.RESEND_API_KEY;
  const prevFrom = process.env.SA360_TRANSACTIONAL_EMAIL_FROM;
  t.after(() => {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
    if (prevFrom === undefined) delete process.env.SA360_TRANSACTIONAL_EMAIL_FROM;
    else process.env.SA360_TRANSACTIONAL_EMAIL_FROM = prevFrom;
  });
  delete process.env.RESEND_API_KEY;
  delete process.env.SA360_TRANSACTIONAL_EMAIL_FROM;
  assert.equal(isTransactionalEmailConfigured(), false);
  process.env.RESEND_API_KEY = "re_test";
  process.env.SA360_TRANSACTIONAL_EMAIL_FROM = "SA360 <a@b.com>";
  assert.equal(isTransactionalEmailConfigured(), true);
});

test("sendTransactionalEmail returns skipped when not configured", async (t) => {
  const prevKey = process.env.RESEND_API_KEY;
  t.after(() => {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
  });
  delete process.env.RESEND_API_KEY;
  const result = await sendTransactionalEmail({
    to: "sam@lifeagentlaunch.com",
    subject: "Test",
    text: "Hello",
  });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
});
