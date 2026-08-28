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

test("sendTransactionalEmail forwards Idempotency-Key and never attaches files", async (t) => {
  const prevKey = process.env.RESEND_API_KEY;
  const prevFrom = process.env.SA360_TRANSACTIONAL_EMAIL_FROM;
  t.after(() => {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
    if (prevFrom === undefined) delete process.env.SA360_TRANSACTIONAL_EMAIL_FROM;
    else process.env.SA360_TRANSACTIONAL_EMAIL_FROM = prevFrom;
  });
  process.env.RESEND_API_KEY = "re_test";
  process.env.SA360_TRANSACTIONAL_EMAIL_FROM = "SA360 <a@b.com>";

  let captured: { url: string; init: RequestInit } | undefined;
  const result = await sendTransactionalEmail(
    {
      to: "customer@example.com",
      subject: "Your SA360 order is ready",
      text: "Ready",
      idempotencyKey: "delivery-release:pkg_1",
    },
    async (url, init) => {
      captured = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
    }
  );

  assert.equal(result.ok, true);
  assert.ok(captured);
  const headers = new Headers(captured.init.headers);
  assert.equal(headers.get("Idempotency-Key"), "delivery-release:pkg_1");
  const body = JSON.parse(String(captured.init.body)) as Record<string, unknown>;
  assert.equal(Object.hasOwn(body, "attachments"), false);
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
