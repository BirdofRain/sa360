import assert from "node:assert/strict";
import test from "node:test";

import {
  EXTERNAL_WEBHOOK_BRIDGE_FLAG,
  externalWebhookBridgeAudit,
  isExternalWebhookConfigBridgeEnabled,
  projectExternalWebhookPreflight,
  projectExternalWebhookStatus,
  readExternalWebhookBridgeError,
} from "./external-webhook-bridge.ts";

const CLIENT = "harbor_benefits";

test("the bridge flag is exact true", () => {
  assert.equal(isExternalWebhookConfigBridgeEnabled({} as unknown as NodeJS.ProcessEnv), false);
  for (const value of ["", " ", "TRUE", "1", "yes", "on"]) {
    assert.equal(
      isExternalWebhookConfigBridgeEnabled({ [EXTERNAL_WEBHOOK_BRIDGE_FLAG]: value } as unknown as NodeJS.ProcessEnv),
      false
    );
  }
  assert.equal(
    isExternalWebhookConfigBridgeEnabled({ [EXTERNAL_WEBHOOK_BRIDGE_FLAG]: "true" } as unknown as NodeJS.ProcessEnv),
    true
  );
});

test("status projection keeps hostname and drops the endpoint and secret", () => {
  const status = projectExternalWebhookStatus(
    {
      clientAccountId: CLIENT,
      present: true,
      kind: "external_https",
      authMode: "hmac_sha256",
      hostname: "hooks.example.com",
      enabled: false,
      revision: 2,
      configurationValid: true,
      primaryCrmConflict: false,
      endpointUrl: "https://hooks.example.com/path-token",
      signingSecret: "hmac-secret",
      latestAttempt: {
        state: "attempted",
        outcome: "http_accepted",
        httpStatus: 204,
        httpAccepted: true,
        provesCrmCreation: true,
        payloadCanonicalJson: "{\"contact\":{\"first_name\":\"Ada\"}}",
      },
    },
    CLIENT
  );
  assert.ok(status);
  assert.equal(status?.latestAttempt?.httpAccepted, true);
  assert.equal(status?.latestAttempt?.provesCrmCreation, false);
  assert.equal(JSON.stringify(status).includes("path-token"), false);
  assert.equal(JSON.stringify(status).includes("hmac-secret"), false);
  assert.equal(JSON.stringify(status).includes("Ada"), false);
  assert.equal(projectExternalWebhookStatus({ clientAccountId: "other", enabled: false, revision: 0 }, CLIENT), null);
});

test("preflight projection rejects a report that would post a lead", () => {
  const report = projectExternalWebhookPreflight({
    postsLead: false,
    hostname: "hooks.example.com",
    endpointValid: false,
    endpointCode: "private_address",
    authValid: true,
    authCode: null,
    credentialsReady: true,
    primaryCrmConflict: true,
    currentRevision: 0,
    revisionMatches: true,
    canary: { implemented: false, consumerLeadData: false },
    endpointUrl: "https://hooks.example.com/path-token",
  });
  assert.equal(report?.endpointCode, "private_address");
  assert.equal(report?.canaryImplemented, false);
  assert.equal(JSON.stringify(report).includes("path-token"), false);
  assert.equal(projectExternalWebhookPreflight({ ...report, postsLead: true, canary: { implemented: false, consumerLeadData: false } }), null);
});

test("upstream errors become safe codes and audit records have no credentials", () => {
  assert.deepEqual(readExternalWebhookBridgeError(409, JSON.stringify({ ok: false, error: "revision_conflict" })), {
    code: "revision_conflict",
    needsReload: true,
  });
  assert.equal(
    readExternalWebhookBridgeError(409, JSON.stringify({ error: "endpoint_rejected", code: "not_https", endpointUrl: "http://secret.example/token" })).code,
    "not_https"
  );
  assert.equal(readExternalWebhookBridgeError(500, "https://hooks.example.com/path-token hmac-secret").code, "unavailable");
  const audit = externalWebhookBridgeAudit({
    actor: "staff",
    staffPrincipalId: "c123456789012345678901234",
    clientAccountId: CLIENT,
    operation: "save",
    requestId: "6f1e2d3c-4b5a-4678-89ab-cdef01234567",
    revision: 1,
    result: "ok",
    code: null,
    at: "2026-11-16T21:00:00.000Z",
  });
  assert.equal(JSON.stringify(audit).includes("http"), false);
  assert.equal(audit.event, "external_webhook_config_bridge");
});
