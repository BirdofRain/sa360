import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  getLeadCaptureDataApiLeadById,
  listLeadCaptureDataApiLeads,
} from "./leadcapture-data-api.client.js";
import type { LeadCaptureDataApiTransport } from "./leadcapture-data-api.types.js";
import {
  buildLeadCaptureTrustPacketFromApiRecord,
  maskProviderLeadId,
} from "./leadcapture-trust-packet.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const completeFixture = JSON.parse(
  readFileSync(join(__dirname, "../../fixtures/leadcapture-data-api/leadcapture-data-api-lead-complete.json"), "utf8")
);
const pageFixture = JSON.parse(
  readFileSync(join(__dirname, "../../fixtures/leadcapture-data-api/leadcapture-data-api-leads-page.json"), "utf8")
);

function mockTransport(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>): LeadCaptureDataApiTransport {
  let call = 0;
  return async () => {
    const next = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: next.headers,
    });
  };
}

test("LeadCapture client applies bearer auth without echoing token", async () => {
  const prevEnabled = process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED;
  const prevToken = process.env.SA360_LEADCAPTURE_DATA_API_TOKEN;
  process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED = "true";
  process.env.SA360_LEADCAPTURE_DATA_API_TOKEN = "lc_live_secret_token_value";

  let authHeader = "";
  const transport: LeadCaptureDataApiTransport = async (_url, init) => {
    authHeader = String((init?.headers as Record<string, string>)?.Authorization ?? "");
    return new Response(JSON.stringify(completeFixture), { status: 200 });
  };

  const result = await getLeadCaptureDataApiLeadById("jt-legacy-e2e-20260616-112541", transport);
  assert.equal(result.ok, true);
  assert.equal(authHeader, "Bearer lc_live_secret_token_value");
  assert.equal(JSON.stringify(result).includes("lc_live_secret"), false);

  if (prevEnabled === undefined) delete process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED;
  else process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED = prevEnabled;
  if (prevToken === undefined) delete process.env.SA360_LEADCAPTURE_DATA_API_TOKEN;
  else process.env.SA360_LEADCAPTURE_DATA_API_TOKEN = prevToken;
});

test("LeadCapture client handles 429 with Retry-After then succeeds", async () => {
  const prevEnabled = process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED;
  const prevToken = process.env.SA360_LEADCAPTURE_DATA_API_TOKEN;
  process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED = "true";
  process.env.SA360_LEADCAPTURE_DATA_API_TOKEN = "lc_live_test";

  const transport = mockTransport([
    { status: 429, body: { error: "rate_limited" }, headers: { "Retry-After": "0" } },
    { status: 200, body: completeFixture },
  ]);

  const result = await getLeadCaptureDataApiLeadById("lead-1", transport);
  assert.equal(result.ok, true);

  if (prevEnabled === undefined) delete process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED;
  else process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED = prevEnabled;
  if (prevToken === undefined) delete process.env.SA360_LEADCAPTURE_DATA_API_TOKEN;
  else process.env.SA360_LEADCAPTURE_DATA_API_TOKEN = prevToken;
});

test("LeadCapture client paginates leads page", async () => {
  const prevEnabled = process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED;
  const prevToken = process.env.SA360_LEADCAPTURE_DATA_API_TOKEN;
  process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED = "true";
  process.env.SA360_LEADCAPTURE_DATA_API_TOKEN = "lc_live_test";

  const transport = mockTransport([{ status: 200, body: pageFixture }]);
  const result = await listLeadCaptureDataApiLeads({ limit: 2 }, transport);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.data.length, 2);
    assert.equal(result.data.has_more, true);
    assert.equal(result.data.next_cursor, "cursor-page-2");
  }

  if (prevEnabled === undefined) delete process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED;
  else process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED = prevEnabled;
  if (prevToken === undefined) delete process.env.SA360_LEADCAPTURE_DATA_API_TOKEN;
  else process.env.SA360_LEADCAPTURE_DATA_API_TOKEN = prevToken;
});

test("LeadCapture trust packet masks provider lead id", () => {
  const packet = buildLeadCaptureTrustPacketFromApiRecord(completeFixture);
  const masked = maskProviderLeadId(packet.identity.providerLeadId);
  assert.ok(masked?.includes("***"));
  assert.equal(masked?.includes("jt-legacy-e2e-20260616-112541"), false);
});

test("LeadCapture client fails closed when trust sync disabled", async () => {
  const prevEnabled = process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED;
  delete process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED;
  const result = await getLeadCaptureDataApiLeadById("lead-1", mockTransport([{ status: 200, body: completeFixture }]));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "disabled");
  if (prevEnabled !== undefined) process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED = prevEnabled;
});

test("complete fixture trust packet includes form 23381 and accepted consent", () => {
  const packet = buildLeadCaptureTrustPacketFromApiRecord(completeFixture);
  assert.equal(packet.identity.providerFormId, "23381");
  assert.equal(packet.trustEvidence.disclosureAccepted, true);
});
