import assert from "node:assert/strict";
import { test } from "node:test";

import { startRuntimeDiagnostics, type RuntimeSample } from "./runtime-diagnostics.js";

test("runtime diagnostics emit memory, uptime, and event-loop fields", async () => {
  const samples: RuntimeSample[] = [];
  const stop = startRuntimeDiagnostics((sample) => {
    samples.push(sample);
  }, 20);
  try {
    await new Promise((resolve) => setTimeout(resolve, 80));
  } finally {
    stop();
  }
  assert.ok(samples.length >= 1);
  const sample = samples[0]!;
  assert.equal(typeof sample.eventLoopDelayP99Ms, "number");
  assert.equal(typeof sample.eventLoopDelayMaxMs, "number");
  assert.equal(typeof sample.eventLoopUtilization, "number");
  assert.ok(sample.rssBytes > 0);
  assert.ok(sample.heapUsedBytes > 0);
  assert.ok(sample.uptimeSeconds >= 0);
  const encoded = JSON.stringify(sample);
  assert.equal(encoded.includes("token"), false);
  assert.equal(encoded.includes("@"), false);
  const afterStop = samples.length;
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(samples.length, afterStop);
});
