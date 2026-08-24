import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  buildRefusedTestRuntimePayload,
  isManualOpsTestRuntime,
  MANUAL_OPS_REFUSED_TEST_RUNTIME,
} from "./manual-ops-runtime.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

test("isManualOpsTestRuntime is true only when NODE_ENV=test", () => {
  assert.equal(isManualOpsTestRuntime({ NODE_ENV: "test" }), true);
  assert.equal(isManualOpsTestRuntime({}), false);
  assert.equal(isManualOpsTestRuntime({ NODE_ENV: "production" }), false);
  assert.equal(isManualOpsTestRuntime({ NODE_ENV: "development" }), false);
});

test("refused payload is PII-free and names the CLI", () => {
  const payload = buildRefusedTestRuntimePayload("source-intake:nextgen-one-event-promote");
  assert.equal(payload.outcome, "REFUSED");
  assert.equal(payload.ok, false);
  assert.equal(payload.reasonCode, MANUAL_OPS_REFUSED_TEST_RUNTIME);
  assert.equal(payload.code, MANUAL_OPS_REFUSED_TEST_RUNTIME);
  assert.equal(payload.writesAttempted, false);
  assert.match(payload.reason, /NODE_ENV is unset/);
  assert.match(payload.reason, /Do not set NODE_ENV=production/);
});

function spawnManualOpsCli(scriptName: string) {
  return spawnSync("pnpm", ["exec", "tsx", join("scripts", scriptName)], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test" },
    shell: true,
  });
}

test("nextgen promote CLI refuses test runtime before API imports", () => {
  const result = spawnManualOpsCli("leadcapture-nextgen-one-event-promote.ts");
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  assert.match(output, /REFUSED_TEST_RUNTIME/, output);
  assert.equal(result.status, 2, output);
  assert.doesNotMatch(output, /SA360_TEST_DATABASE_URL host must be localhost/);
});

test("commerce exclude CLI refuses test runtime before API imports", () => {
  const result = spawnManualOpsCli("inventory-commerce-exclude.ts");
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  assert.match(output, /REFUSED_TEST_RUNTIME/, output);
  assert.equal(result.status, 2, output);
});
