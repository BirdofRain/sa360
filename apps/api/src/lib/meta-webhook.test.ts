import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  DEFAULT_GRAPH_API_VERSION,
  getMetaWebhookConfig,
  redactSensitiveWebhookUrl,
  metaHandshakeLogBody,
  resolveMetaPageAccessToken,
  validateMetaSignature,
  verifyMetaWebhookChallenge,
} from "./meta-webhook.js";

test("verifyMetaWebhookChallenge returns challenge on valid subscribe + token", () => {
  const result = verifyMetaWebhookChallenge(
    { "hub.mode": "subscribe", "hub.verify_token": "vt-123", "hub.challenge": "echo-me" },
    "vt-123"
  );
  assert.deepEqual(result, { ok: true, challenge: "echo-me" });
});

test("verifyMetaWebhookChallenge rejects wrong token", () => {
  const result = verifyMetaWebhookChallenge(
    { "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "echo-me" },
    "vt-123"
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "token_mismatch");
});

test("verifyMetaWebhookChallenge rejects wrong mode", () => {
  const result = verifyMetaWebhookChallenge(
    { "hub.mode": "unsubscribe", "hub.verify_token": "vt-123", "hub.challenge": "x" },
    "vt-123"
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "mode_mismatch");
});

test("verifyMetaWebhookChallenge fails when no verify token configured", () => {
  const result = verifyMetaWebhookChallenge(
    { "hub.mode": "subscribe", "hub.verify_token": "vt", "hub.challenge": "x" },
    null
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "missing_config");
});

test("validateMetaSignature skips when no app secret configured", () => {
  const prevEnv = process.env.SA360_ENV;
  process.env.SA360_ENV = "development";
  const result = validateMetaSignature("{}", undefined, null);
  assert.deepEqual(result, { ok: true, skipped: true });
  if (prevEnv !== undefined) process.env.SA360_ENV = prevEnv;
  else delete process.env.SA360_ENV;
});

test("validateMetaSignature fails closed in production when META_APP_SECRET is missing", () => {
  const prevEnv = process.env.SA360_ENV;
  process.env.SA360_ENV = "production";
  const result = validateMetaSignature("{}", undefined, null);
  assert.deepEqual(result, { ok: false, reason: "missing_secret" });
  if (prevEnv !== undefined) process.env.SA360_ENV = prevEnv;
  else delete process.env.SA360_ENV;
});

test("validateMetaSignature accepts a correct sha256 signature", () => {
  const secret = "app-secret-xyz";
  const body = JSON.stringify({ entry: [{ id: "page_1" }] });
  const digest = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  const result = validateMetaSignature(body, `sha256=${digest}`, secret);
  assert.deepEqual(result, { ok: true, skipped: false });
});

test("validateMetaSignature rejects a tampered body", () => {
  const secret = "app-secret-xyz";
  const body = JSON.stringify({ entry: [{ id: "page_1" }] });
  const digest = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  const result = validateMetaSignature(`${body} `, `sha256=${digest}`, secret);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "bad_signature");
});

test("validateMetaSignature rejects a missing signature header when secret set", () => {
  const result = validateMetaSignature("{}", undefined, "app-secret-xyz");
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "missing_signature");
});

test("getMetaWebhookConfig Meta Lead Ads flags default false", () => {
  const saved = {
    SA360_META_LEAD_ADS_INTAKE_ENABLED: process.env.SA360_META_LEAD_ADS_INTAKE_ENABLED,
    SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED: process.env.SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED,
    SA360_META_LEAD_ADS_ROUTING_ENABLED: process.env.SA360_META_LEAD_ADS_ROUTING_ENABLED,
    SA360_META_LEAD_ADS_FIXTURE_ENABLED: process.env.SA360_META_LEAD_ADS_FIXTURE_ENABLED,
    FACEBOOK_DIRECT_INTAKE_ENABLED: process.env.FACEBOOK_DIRECT_INTAKE_ENABLED,
  };
  delete process.env.SA360_META_LEAD_ADS_INTAKE_ENABLED;
  delete process.env.SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED;
  delete process.env.SA360_META_LEAD_ADS_ROUTING_ENABLED;
  delete process.env.SA360_META_LEAD_ADS_FIXTURE_ENABLED;
  delete process.env.FACEBOOK_DIRECT_INTAKE_ENABLED;
  try {
    const cfg = getMetaWebhookConfig();
    assert.equal(cfg.intakeEnabled, false);
    assert.equal(cfg.graphFetchEnabled, false);
    assert.equal(cfg.routingEnabled, false);
    assert.equal(cfg.fixtureEnabled, false);
    assert.equal(cfg.directIntakeEnabled, false);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("getMetaWebhookConfig honors FACEBOOK_DIRECT_INTAKE_ENABLED as legacy intake/graph/routing alias", () => {
  const saved = {
    SA360_META_LEAD_ADS_INTAKE_ENABLED: process.env.SA360_META_LEAD_ADS_INTAKE_ENABLED,
    SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED: process.env.SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED,
    SA360_META_LEAD_ADS_ROUTING_ENABLED: process.env.SA360_META_LEAD_ADS_ROUTING_ENABLED,
    SA360_META_LEAD_ADS_FIXTURE_ENABLED: process.env.SA360_META_LEAD_ADS_FIXTURE_ENABLED,
    FACEBOOK_DIRECT_INTAKE_ENABLED: process.env.FACEBOOK_DIRECT_INTAKE_ENABLED,
  };
  delete process.env.SA360_META_LEAD_ADS_INTAKE_ENABLED;
  delete process.env.SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED;
  delete process.env.SA360_META_LEAD_ADS_ROUTING_ENABLED;
  delete process.env.SA360_META_LEAD_ADS_FIXTURE_ENABLED;
  process.env.FACEBOOK_DIRECT_INTAKE_ENABLED = "true";
  try {
    const cfg = getMetaWebhookConfig();
    assert.equal(cfg.intakeEnabled, true);
    assert.equal(cfg.graphFetchEnabled, true);
    assert.equal(cfg.routingEnabled, true);
    assert.equal(cfg.directIntakeEnabled, true);
    assert.equal(cfg.fixtureEnabled, false);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("redactSensitiveWebhookUrl never retains hub.verify_token", () => {
  const redacted = redactSensitiveWebhookUrl(
    "/webhooks/meta/leadgen?hub.mode=subscribe&hub.verify_token=super-secret-vt&hub.challenge=987654"
  );
  assert.equal(redacted.includes("super-secret-vt"), false);
  assert.match(redacted, /hub.verify_token=%2A%2A%2AREDACTED%2A%2A%2A|hub.verify_token=\*\*\*REDACTED\*\*\*/);
  assert.match(redacted, /hub.challenge=987654/);
});

test("OAuth callback access logs redact authorization code, state, and descriptions", () => {
  const redacted = redactSensitiveWebhookUrl(
    "/integrations/google/oauth/callback?code=authorization-secret&state=raw-state&error_description=private-detail&error=access_denied"
  );
  assert.equal(redacted.includes("authorization-secret"), false);
  assert.equal(redacted.includes("raw-state"), false);
  assert.equal(redacted.includes("private-detail"), false);
  assert.match(redacted, /error=access_denied/);
});

test("Graph API version defaults to v25.0 (matches the app dashboard) and honors the override", () => {
  const saved = {
    META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION,
    META_PAGE_ACCESS_TOKEN_PAGE_ID: process.env.META_PAGE_ACCESS_TOKEN_PAGE_ID,
  };
  delete process.env.META_GRAPH_API_VERSION;
  delete process.env.META_PAGE_ACCESS_TOKEN_PAGE_ID;
  try {
    assert.equal(DEFAULT_GRAPH_API_VERSION, "v25.0");
    assert.equal(getMetaWebhookConfig().graphApiVersion, "v25.0");
    assert.equal(getMetaWebhookConfig().accessTokenPageId, null);
    process.env.META_GRAPH_API_VERSION = "v26.0";
    process.env.META_PAGE_ACCESS_TOKEN_PAGE_ID = " 102720336121632 ";
    assert.equal(getMetaWebhookConfig().graphApiVersion, "v26.0");
    assert.equal(getMetaWebhookConfig().accessTokenPageId, "102720336121632");
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("resolveMetaPageAccessToken binds one token to one Page and never leaks the token", () => {
  const token = "EAAB-pilot-token-value";
  // Unbound: single-token posture, operator owns the assumption.
  assert.deepEqual(resolveMetaPageAccessToken("102720336121632", { accessToken: token, accessTokenPageId: null }), {
    ok: true,
    accessToken: token,
    scope: "unbound",
  });
  // Bound and matching.
  assert.deepEqual(
    resolveMetaPageAccessToken("102720336121632", { accessToken: token, accessTokenPageId: "102720336121632" }),
    { ok: true, accessToken: token, scope: "page_bound" }
  );
  // Bound and a different Page: terminal with diagnostic, token not used.
  const other = resolveMetaPageAccessToken("999", { accessToken: token, accessTokenPageId: "102720336121632" });
  assert.equal(other.ok, false);
  if (!other.ok) {
    assert.equal(other.reason, "page_token_not_configured");
    assert.match(other.diagnostic, /Page 999/);
    assert.match(other.diagnostic, /102720336121632/);
    assert.equal(other.diagnostic.includes(token), false);
  }
  // Bound but the notification has no Page ID.
  const unknown = resolveMetaPageAccessToken(undefined, { accessToken: token, accessTokenPageId: "102720336121632" });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.reason, "page_id_unknown");
  // No token at all.
  const missing = resolveMetaPageAccessToken("102720336121632", { accessToken: null, accessTokenPageId: null });
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.reason, "missing_access_token");
    assert.match(missing.diagnostic, /META_PAGE_ACCESS_TOKEN/);
  }
});

test("metaHandshakeLogBody omits hub.verify_token", () => {
  const body = metaHandshakeLogBody({
    "hub.mode": "subscribe",
    "hub.verify_token": "vt-must-not-appear",
    "hub.challenge": "echo-me",
  });
  assert.equal(JSON.stringify(body).includes("vt-must-not-appear"), false);
  assert.equal("hub.verify_token" in body, false);
  assert.equal(body["hub.challenge"], "echo-me");
});
