import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_DETAIL_CRITICAL_READS,
  CLIENT_DETAIL_DIAGNOSTIC_READS,
  clientDetailNavigationPass,
  clientDetailReadRecord,
  logClientDetailRead,
  readClientDetailHttpStatus,
  resetClientDetailNavigationPasses,
  timeClientDetailRead,
} from "./client-detail-reads.ts";

test.beforeEach(() => {
  resetClientDetailNavigationPasses();
});

test("client setup does not wait on diagnostic reads", () => {
  const critical = CLIENT_DETAIL_CRITICAL_READS.map((read) => read.operation);
  assert.deepEqual(critical, ["client_detail", "client_setup"]);
  assert.equal(CLIENT_DETAIL_CRITICAL_READS.every((read) => read.essentialForClientSetup), true);
  assert.equal(CLIENT_DETAIL_DIAGNOSTIC_READS.some((read) => read.blocksInitialRender), false);
  assert.equal(CLIENT_DETAIL_DIAGNOSTIC_READS.some((read) => read.essentialForClientSetup), false);
  assert.equal(
    CLIENT_DETAIL_DIAGNOSTIC_READS.some((read) => read.operation === "onboarding_summary"),
    true
  );
  const campaignInventory = CLIENT_DETAIL_DIAGNOSTIC_READS.find((read) => read.operation === "campaign_inventory");
  assert.equal(campaignInventory?.endpoint, "GET /admin/v1/clients/:id/campaign-inventory");
  assert.equal(campaignInventory?.blocksInitialRender, false);
  assert.equal(campaignInventory?.essentialForClientSetup, false);
  assert.equal(
    CLIENT_DETAIL_CRITICAL_READS.find((read) => read.operation === "client_detail")?.blocksInitialRender,
    true
  );
  assert.equal(
    CLIENT_DETAIL_CRITICAL_READS.find((read) => read.operation === "client_setup")?.blocksInitialRender,
    false
  );
});

test("cold and repeat navigation are distinguished without caching a payload", () => {
  assert.equal(clientDetailNavigationPass("client_detail"), "cold");
  assert.equal(clientDetailNavigationPass("client_detail"), "repeat");
  assert.equal(clientDetailNavigationPass("client_setup"), "cold");
});

test("http status comes from the result and a thrown read has no status", async () => {
  assert.equal(readClientDetailHttpStatus({ ok: true, data: {} }), 200);
  assert.equal(readClientDetailHttpStatus({ data: { item: {} }, error: null, status: 200 }), 200);
  assert.equal(readClientDetailHttpStatus({ ok: false, error: "destination_disabled", status: 404 }), 404);
  assert.equal(readClientDetailHttpStatus(null), null);

  const lines: string[] = [];
  const original = console.info;
  console.info = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    await assert.rejects(timeClientDetailRead("onboarding_summary", async () => {
      throw new Error("client-secret-token");
    }));
  } finally {
    console.info = original;
  }
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0] ?? "{}") as { httpStatus: number | null; endpoint: string };
  assert.equal(record.httpStatus, null);
  assert.equal(record.endpoint, "GET /admin/v1/clients/:id/onboarding");
  assert.equal(lines[0]?.includes("client-secret-token"), false);
  assert.equal(lines[0]?.includes("authorization"), false);
});

test("timing log keeps operation identifiers and drops client data", () => {
  const lines: string[] = [];
  const original = console.info;
  console.info = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    logClientDetailRead(
      clientDetailReadRecord({
        operation: "client_detail",
        endpoint: "GET /admin/v1/clients/:id",
        durationMs: 12,
        httpStatus: 200,
        blocksInitialRender: true,
        essentialForClientSetup: true,
        navigation: "cold",
      })
    );
  } finally {
    console.info = original;
  }
  const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
  assert.equal(record.event, "client_detail_read");
  assert.equal(record.operation, "client_detail");
  assert.equal(record.durationMs, 12);
  assert.equal(Object.hasOwn(record, "clientAccountId"), false);
  assert.equal(Object.hasOwn(record, "body"), false);
});

test("a slow diagnostic stays pending after setup resolves", async () => {
  let diagnosticSettled = false;
  const setup = timeClientDetailRead("client_setup", async () => ({ data: { item: { revision: 1 } }, error: null, status: 200 }));
  const diagnostic = timeClientDetailRead("onboarding_summary", () => new Promise<{ ok: false; status: number }>((resolve) => {
    setTimeout(() => {
      diagnosticSettled = true;
      resolve({ ok: false, status: 503 });
    }, 40);
  }));
  const setupResult = await setup;
  assert.equal(setupResult.status, 200);
  assert.equal(diagnosticSettled, false);
  const diagnosticResult = await diagnostic;
  assert.equal(diagnosticResult.status, 503);
  assert.equal(diagnosticSettled, true);
});
