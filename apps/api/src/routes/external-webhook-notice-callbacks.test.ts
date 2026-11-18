import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";
import Fastify from "fastify";

import { applyTwilioNoticeStatus } from "../services/external-webhook-notification/notice-callbacks.js";
import { twilioRequestSignature } from "../services/external-webhook-notification/twilio-signature.js";
import {
  externalWebhookNoticeCallbackRoutes,
  TWILIO_EMPTY_INBOUND_TWIML,
} from "./external-webhook-notice-callbacks.js";

const INBOUND_URL = "https://api.example.test/integrations/twilio/external-webhook-notice/inbound";
const STATUS_URL = "https://api.example.test/integrations/twilio/external-webhook-notice/status";
const TOKEN = "c".repeat(32);

test("inbound form fields are signed and a valid request returns empty TwiML", async () => {
  const app = Fastify();
  await app.register(externalWebhookNoticeCallbackRoutes, {
    inboundUrl: INBOUND_URL,
    statusUrl: STATUS_URL,
    authToken: TOKEN,
    env: { SA360_SMS_INBOUND_OPT_OUT_ENABLED: "false" },
  });
  const params = {
    AccountSid: `AC${"a".repeat(32)}`,
    Body: "STOP",
    From: "+15555550100",
    NumMedia: "0",
    OptOutType: "STOP",
    To: "+18884095462",
  };
  const missing = await app.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/inbound",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(params).toString(),
  });
  assert.equal(missing.statusCode, 403);
  assert.match(missing.body, /invalid_signature/);

  const invalid = await app.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/inbound",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": "not-a-signature" },
    payload: new URLSearchParams(params).toString(),
  });
  assert.equal(invalid.statusCode, 403);

  const partial = twilioRequestSignature(INBOUND_URL, { Body: params.Body, From: params.From }, TOKEN);
  const altered = await app.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/inbound",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": partial },
    payload: new URLSearchParams(params).toString(),
  });
  assert.equal(altered.statusCode, 403);

  const signed = await app.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/inbound",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioRequestSignature(INBOUND_URL, params, TOKEN),
    },
    payload: new URLSearchParams(params).toString(),
  });
  assert.equal(signed.statusCode, 200);
  assert.match(String(signed.headers["content-type"]), /text\/xml/);
  assert.equal(signed.body, TWILIO_EMPTY_INBOUND_TWIML);
  assert.equal(signed.body.includes("<Message"), false);

  const wrongUrl = await app.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/status",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioRequestSignature(INBOUND_URL, { MessageSid: `SM${"b".repeat(32)}`, MessageStatus: "delivered" }, TOKEN),
    },
    payload: new URLSearchParams({ MessageSid: `SM${"b".repeat(32)}`, MessageStatus: "delivered" }).toString(),
  });
  assert.equal(wrongUrl.statusCode, 403);
  await app.close();
});

test("an unknown or malformed status callback does not invent a receipt", async () => {
  let reads = 0;
  const db = {
    externalWebhookNotificationReceipt: {
      findFirst: async () => {
        reads += 1;
        return null;
      },
    },
    ghlLeadReceivedNotice: {
      findFirst: async () => null,
    },
  } as unknown as PrismaClient;
  const sid = `SM${"d".repeat(32)}`;
  const unknown = await applyTwilioNoticeStatus(db, { MessageSid: sid, MessageStatus: "delivered" });
  assert.deepEqual(unknown, { ok: true, applied: "unknown_sid" });
  assert.equal(reads, 1);
  const ignored = await applyTwilioNoticeStatus(db, { MessageSid: "not-a-sid", MessageStatus: "delivered" });
  assert.deepEqual(ignored, { ok: true, applied: "ignored" });
  assert.equal(reads, 1);
});
