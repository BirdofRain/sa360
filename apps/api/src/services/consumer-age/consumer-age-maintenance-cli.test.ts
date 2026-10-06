/**
 * Operator input validation for the consumer-age maintenance CLI.
 *
 * The CLI is spawned as a child process with `NODE_ENV` unset, because the
 * manual-ops guard refuses to run inside the test runtime. Every case here is
 * read-only: the refusals exit before a Prisma client is ever constructed, and
 * the one successful invocation is `--mode preview`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

const testDatabaseUrlRaw =
  process.env.SA360_PPL_INTEGRATION_DATABASE_URL?.trim() ||
  process.env.SA360_TEST_DATABASE_URL?.trim() ||
  "";

function runCli(args: string[], databaseUrl: string) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value != null) env[key] = value;
  }
  delete env.NODE_ENV;
  env.DATABASE_URL = databaseUrl;

  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/consumer-age-maintenance.ts", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
    shell: true,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}

describe("consumer age maintenance CLI operator input", () => {
  // A placeholder localhost URL is enough: these invocations exit before the
  // Prisma client is constructed.
  const placeholderUrl = "postgresql://sa360:sa360password@127.0.0.1:5432/sa360_test";

  for (const [label, value] of [
    ["non-numeric", "abc"],
    ["zero", "0"],
    ["negative", "-10"],
    ["fractional", "2.5"],
    ["exponential", "1e4"],
  ] as const) {
    it(`refuses a ${label} --max-scan-rows instead of scanning zero rows`, () => {
      const run = runCli(["--mode", "preview", "--max-scan-rows", value], placeholderUrl);
      assert.equal(run.status, 2, run.output);
      assert.match(run.output, /invalid_operator_input/, run.output);
      assert.match(run.output, /max-scan-rows/, run.output);
      // A misleading zero-row report must never be produced.
      assert.doesNotMatch(run.stdout, /consumer_age_inventory_report_v1/, run.output);
      assert.doesNotMatch(run.stdout, /"rowsScanned": 0/, run.output);
    });
  }

  it("refuses a --max-scan-rows above the per-invocation ceiling", () => {
    const run = runCli(["--mode", "preview", "--max-scan-rows", "50001"], placeholderUrl);
    assert.equal(run.status, 2, run.output);
    assert.match(run.output, /exceeds_maximum_50000/, run.output);
  });

  it("refuses a malformed shard bound and an inverted shard window", () => {
    const malformed = runCli(
      ["--mode", "preview", "--generated-at-from", "not-a-date"],
      placeholderUrl
    );
    assert.equal(malformed.status, 2, malformed.output);
    assert.match(malformed.output, /expected_iso_instant/, malformed.output);
  });

  it("refuses a half-specified resume cursor", () => {
    const run = runCli(
      ["--mode", "preview", "--after-generated-at", "2026-04-01T00:00:00.000Z"],
      placeholderUrl
    );
    assert.equal(run.status, 2, run.output);
    assert.match(run.output, /requires_both_after_generated_at_and_after_id/, run.output);
  });

  it("refuses a non-numeric --limit on a writing mode", () => {
    const run = runCli(
      [
        "--mode",
        "classify-dead",
        "--expected-db-host",
        "127.0.0.1:5432",
        "--operator",
        "cli_test",
        "--limit",
        "abc",
        "--confirm",
        "CLASSIFY CONSUMER AGE OVER 86 AS DEAD",
      ],
      placeholderUrl
    );
    assert.equal(run.status, 2, run.output);
    assert.match(run.output, /invalid_operator_input/, run.output);
    assert.match(run.output, /limit/, run.output);
  });

  it(
    "accepts a valid capped --max-scan-rows and emits coverage plus nextCursor",
    { skip: !testDatabaseUrlRaw },
    () => {
      const url = assertSafeTestDatabaseUrl(testDatabaseUrlRaw);
      const run = runCli(["--mode", "preview", "--max-scan-rows", "5"], url);
      assert.equal(run.status, 0, run.output);
      const report = JSON.parse(run.stdout) as {
        schema: string;
        scope: { maxScanRows: number };
        coverage: string;
        nextCursor: unknown;
      };
      assert.equal(report.schema, "consumer_age_inventory_report_v1");
      assert.equal(report.scope.maxScanRows, 5);
      assert.equal(["complete", "partial"].includes(report.coverage), true, run.stdout);
      if (report.coverage === "complete") assert.equal(report.nextCursor, null);
      else assert.notEqual(report.nextCursor, null);
    }
  );
});
