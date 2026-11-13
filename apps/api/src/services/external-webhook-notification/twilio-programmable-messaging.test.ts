import assert from "node:assert/strict";
import test from "node:test";

import {
  SMS_NOTIFICATIONS_ENABLED_ENV,
  TWILIO_ACCOUNT_SID_ENV,
  TWILIO_AUTH_TOKEN_ENV,
  TWILIO_MESSAGE_STATUSES,
  TWILIO_MESSAGING_SERVICE_SID_ENV,
  TWILIO_SMS_FROM_ENV,
  classifyTwilioErrorCode,
  classifyTwilioMessageStatus,
  isSmsNotificationsEnabled,
  mapTwilioMessageStatus,
  postTwilioProgrammableMessage,
  readTwilioMessagingConfig,
} from "./twilio-programmable-messaging.js";

const ACCOUNT = `AC${"a".repeat(32)}`;
const SERVICE = `MG${"b".repeat(32)}`;
const TOKEN = "c".repeat(32);
const MESSAGE = `SM${"d".repeat(32)}`;
const TO = "+15555550100";
const FROM = "+15555550199";

function configuredEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    [TWILIO_ACCOUNT_SID_ENV]: ACCOUNT,
    [TWILIO_AUTH_TOKEN_ENV]: TOKEN,
    [TWILIO_MESSAGING_SERVICE_SID_ENV]: SERVICE,
    ...extra,
  };
}

test("SMS stays disabled unless the flag is the exact string true", () => {
  assert.equal(isSmsNotificationsEnabled({}), false);
  for (const value of ["", " ", "TRUE", "True", "1", "yes", "on", "false", "trueish"]) {
    assert.equal(isSmsNotificationsEnabled({ [SMS_NOTIFICATIONS_ENABLED_ENV]: value }), false, value);
  }
  assert.equal(isSmsNotificationsEnabled({ [SMS_NOTIFICATIONS_ENABLED_ENV]: "true" }), true);
  assert.equal(isSmsNotificationsEnabled({ [SMS_NOTIFICATIONS_ENABLED_ENV]: " true " }), true);
  assert.equal(isSmsNotificationsEnabled({ [SMS_NOTIFICATIONS_ENABLED_ENV]: "true\n" }), true);
  assert.equal(isSmsNotificationsEnabled(configuredEnv()), false);
});

test("Twilio config requires the LAL Messaging Service SID and rejects a bad sender", () => {
  assert.equal(readTwilioMessagingConfig({}).ok, false);
  const missingService = readTwilioMessagingConfig({
    [TWILIO_ACCOUNT_SID_ENV]: ACCOUNT,
    [TWILIO_AUTH_TOKEN_ENV]: TOKEN,
  });
  assert.equal(missingService.ok, false);
  if (!missingService.ok) assert.equal(missingService.reason, "incomplete");

  const badSender = readTwilioMessagingConfig(configuredEnv({ [TWILIO_SMS_FROM_ENV]: "not-a-phone" }));
  assert.equal(badSender.ok, false);
  if (!badSender.ok) {
    assert.equal(badSender.reason, "invalid_sender");
    assert.equal(JSON.stringify(badSender).includes(TOKEN), false);
  }

  const ready = readTwilioMessagingConfig(configuredEnv({ [TWILIO_SMS_FROM_ENV]: FROM }));
  assert.equal(ready.ok, true);
  if (ready.ok) {
    assert.equal(ready.config.messagingServiceSid, SERVICE);
    assert.equal(ready.config.from, FROM);
  }
  const poolSender = readTwilioMessagingConfig(configuredEnv());
  assert.equal(poolSender.ok, true);
  if (poolSender.ok) assert.equal(poolSender.config.from, null);
});

test("status and provider error codes map without calling Twilio", () => {
  const pending = ["accepted", "scheduled", "queued", "sending"];
  const sent = ["sent", "delivered", "read"];
  const failed = ["undelivered", "failed", "canceled", "partially_delivered"];
  for (const status of TWILIO_MESSAGE_STATUSES) {
    assert.equal(mapTwilioMessageStatus(status.toUpperCase()), status);
    const kind = classifyTwilioMessageStatus(status);
    if (pending.includes(status)) assert.equal(kind, "pending");
    if (sent.includes(status)) assert.equal(kind, "sent");
    if (failed.includes(status)) assert.equal(kind, "failed");
  }
  assert.equal(classifyTwilioMessageStatus("receiving"), "inbound");
  assert.equal(classifyTwilioMessageStatus("received"), "inbound");
  assert.equal(mapTwilioMessageStatus("mystery"), "unknown");
  assert.equal(classifyTwilioMessageStatus("mystery"), "unknown");
  assert.equal(classifyTwilioErrorCode(21610), "stop_suppressed");
  assert.equal(classifyTwilioErrorCode(21211), "invalid_destination");
  assert.equal(classifyTwilioErrorCode(21614), "invalid_destination");
  assert.equal(classifyTwilioErrorCode(21408), "permission_denied");
  assert.equal(classifyTwilioErrorCode(20003), "authentication");
  assert.equal(classifyTwilioErrorCode(20429), "rate_limited");
  assert.equal(classifyTwilioErrorCode(30003), "unreachable");
  assert.equal(classifyTwilioErrorCode(30007), "carrier_filtered");
  assert.equal(classifyTwilioErrorCode(30034), "carrier_filtered");
  assert.equal(classifyTwilioErrorCode(30008), "provider_rejected");
  assert.equal(classifyTwilioErrorCode(null), "provider_rejected");
});

test("a fake client posts the Messaging Service, sender, and message SID", async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  const fetchImpl: typeof fetch = async (url, init) => {
    captured = { url: String(url), init: init ?? {} };
    return new Response(JSON.stringify({ sid: MESSAGE, status: "accepted" }), { status: 201 });
  };
  const result = await postTwilioProgrammableMessage(
    {
      accountSid: ACCOUNT,
      authToken: TOKEN,
      messagingServiceSid: SERVICE,
      to: TO,
      body: "SA360 notice",
      from: FROM,
    },
    fetchImpl
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.provider, "twilio");
    assert.equal(result.providerMessageId, MESSAGE);
    assert.equal(result.providerStatus, "accepted");
    assert.equal(result.statusClass, "pending");
  }
  assert.ok(captured);
  assert.equal(captured.url, `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages.json`);
  assert.equal(captured.init.method, "POST");
  const headers = new Headers(captured.init.headers);
  assert.equal(
    headers.get("Authorization"),
    `Basic ${Buffer.from(`${ACCOUNT}:${TOKEN}`, "utf8").toString("base64")}`
  );
  assert.equal(headers.get("Idempotency-Key"), null);
  assert.equal(headers.get("I-Twilio-Idempotency-Token"), null);
  const body = String(captured.init.body);
  const params = new URLSearchParams(body);
  assert.equal(params.get("To"), TO);
  assert.equal(params.get("MessagingServiceSid"), SERVICE);
  assert.equal(params.get("From"), FROM);
  assert.equal(params.get("Body"), "SA360 notice");
  assert.equal(params.has("StatusCallback"), false);
  assert.equal(body.includes(TOKEN), false);
});

test("the Messaging Service may omit From, and a STOP error does not echo the number", async () => {
  let sawFrom = false;
  const fetchImpl: typeof fetch = async (_url, init) => {
    const params = new URLSearchParams(String(init?.body));
    sawFrom = params.has("From");
    return new Response(
      JSON.stringify({
        code: 21610,
        message: `Attempt to send to unsubscribed recipient ${TO} token ${TOKEN}`,
        status: 400,
      }),
      { status: 400 }
    );
  };
  const result = await postTwilioProgrammableMessage(
    {
      accountSid: ACCOUNT,
      authToken: TOKEN,
      messagingServiceSid: SERVICE,
      to: TO,
      body: "SA360 notice",
      from: null,
    },
    fetchImpl
  );
  assert.equal(sawFrom, false);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorClass, "stop_suppressed");
    assert.equal(result.providerCode, 21610);
    assert.equal(result.providerMessageId, null);
    assert.equal(result.error, "Twilio 400 code 21610");
    assert.equal(result.error.includes(TO), false);
    assert.equal(result.error.includes(TOKEN), false);
  }
});

test("a throwing fetch becomes transport failure and is not invoked by a rejected address", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    throw new Error(`socket down ${TOKEN} ${TO}`);
  };
  const transport = await postTwilioProgrammableMessage(
    {
      accountSid: ACCOUNT,
      authToken: TOKEN,
      messagingServiceSid: SERVICE,
      to: TO,
      body: "SA360 notice",
      from: null,
    },
    fetchImpl
  );
  assert.equal(transport.ok, false);
  if (!transport.ok) {
    assert.equal(transport.errorClass, "transport");
    assert.equal(transport.error, "Twilio request failed");
    assert.equal(transport.error.includes(TOKEN), false);
  }
  const rejected = await postTwilioProgrammableMessage(
    {
      accountSid: ACCOUNT,
      authToken: TOKEN,
      messagingServiceSid: SERVICE,
      to: "5555550100",
      body: "SA360 notice",
      from: null,
    },
    fetchImpl
  );
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.errorClass, "invalid_destination");
  assert.equal(calls, 1);
});
