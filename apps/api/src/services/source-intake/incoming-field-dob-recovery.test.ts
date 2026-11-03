import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  assessIncomingDobRecoveryRow,
  buildIncomingDobRecoveryReport,
  INCOMING_DOB_LATER_UPDATE_POLICY,
  INCOMING_DOB_RECOVERY_REPORT_VERSION,
  INCOMING_DOB_RECOVERY_WINDOW_START,
  KNOWN_DOB_RECOVERY_EVENT_ID,
  type IncomingDobRecoverySnapshot,
} from "./incoming-field-dob-recovery.js";
import { CONFIRMED_JULIA_DODGE_SOURCE_FUNNEL_ID } from "./source-field-alias.registry.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const WINDOW = { receivedFrom: INCOMING_DOB_RECOVERY_WINDOW_START, receivedTo: null };

function snapshot(overrides: Partial<IncomingDobRecoverySnapshot> = {}): IncomingDobRecoverySnapshot {
  return {
    id: "evt_synthetic",
    sourceProvider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    sourceRouteKey: "LCIO_NEXTGEN_VET_SYNTHETIC",
    sourceFunnelName: "Synthetic veteran",
    clientAccountId: "client_synthetic",
    status: "normalized",
    receivedAt: "2026-11-02T18:00:00.000Z",
    deliveredAt: null,
    rawPayload: {
      provider: "leadcapture_io",
      sa360_source_system: "leadcapture_io_nextgen",
      lead_id: "11111111-2222-4333-8444-555555555555",
      submitted_at: "2026-11-02T18:00:00.000Z",
      parent_url: "https://go.lifeinsuranceforvets.com/learn-julia-dodge",
      first_name: "Pat",
      email: "pat.sample@example.test",
      date: "03/13/1955",
    },
    normalizedPayload: { lead_details: {} },
    enrichment: null,
    routingResult: null,
    sheetsDelivered: false,
    ghlDelivered: false,
    commerciallyAllocated: false,
    ...overrides,
  };
}

test("confirmed blank canonical date is eligible and a delivered row stays flagged", () => {
  const eligible = assessIncomingDobRecoveryRow(snapshot(), WINDOW);
  assert.equal(eligible.recoveryClass, "eligible");
  assert.equal(eligible.dateMeansBirthday, true);
  assert.equal(eligible.alreadyDelivered, false);

  const delivered = assessIncomingDobRecoveryRow(
    snapshot({ id: "evt_delivered", deliveredAt: "2026-11-02T19:00:00.000Z", sheetsDelivered: true }),
    WINDOW
  );
  assert.equal(delivered.recoveryClass, "eligible");
  assert.equal(delivered.alreadyDelivered, true);
});

test("census keeps non-birthday dates separate and does not print the date", () => {
  const other = snapshot({
    id: "evt_other",
    rawPayload: {
      provider: "leadcapture_io",
      sa360_source_system: "leadcapture_io_nextgen",
      parent_url: "https://go.lifeinsuranceforvets.com/learn-julia-healthcare-worker",
      date: "11/02/2026",
      email: "other.sample@example.test",
    },
    clientAccountId: "client_other",
  });
  const legacy = snapshot({
    id: "evt_legacy",
    sourceSystem: "leadcapture_io_legacy",
    sourceRouteKey: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
    rawPayload: {
      provider: "leadcapture_io",
      sa360_source_system: "leadcapture_io_legacy",
      sa360_route_key: "LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX",
      answers: { date: "2026-06-16", time: "11:25:41" },
    },
  });
  const known = snapshot({
    id: KNOWN_DOB_RECOVERY_EVENT_ID,
    receivedAt: "2026-10-20T12:00:00.000Z",
    ghlDelivered: true,
    enrichment: { sourceFunnelId: CONFIRMED_JULIA_DODGE_SOURCE_FUNNEL_ID },
  });
  const report = buildIncomingDobRecoveryReport({
    rows: [known, snapshot(), other, legacy],
    receivedFrom: WINDOW.receivedFrom,
    receivedTo: null,
  });
  const printed = JSON.stringify(report);
  assert.equal(report.writes, false);
  assert.equal(report.counts.eligible, 1);
  assert.equal(report.counts.skipped, 2);
  assert.equal(report.knownEvent.found, true);
  assert.equal(report.knownEvent.inWindow, false);
  assert.equal(report.knownEvent.recoveryClass, "eligible");
  assert.equal(report.knownEvent.alreadyDelivered, true);
  assert.equal(report.knownEvent.dateMeansBirthday, true);
  assert.equal(report.census.length, 3);
  assert.equal(report.census.filter((row) => row.dateMeansBirthday).length, 1);
  assert.equal(report.census.some((row) => row.formKey.includes("healthcare-worker")), true);
  assert.equal(printed.includes("03/13/1955"), false);
  assert.equal(printed.includes("1955-03-13"), false);
  assert.equal(printed.includes("pat.sample@example.test"), false);
  assert.equal(INCOMING_DOB_LATER_UPDATE_POLICY.writes, false);
  assert.equal(INCOMING_DOB_LATER_UPDATE_POLICY.implemented, false);
});

test("stored disagreement and an invalid date are not eligible", () => {
  const conflict = assessIncomingDobRecoveryRow(
    snapshot({
      normalizedPayload: { lead_details: { date_of_birth: "1979-04-12", consumer_age: "47" } },
    }),
    WINDOW
  );
  assert.equal(conflict.recoveryClass, "conflicting");

  const unchanged = assessIncomingDobRecoveryRow(
    snapshot({
      normalizedPayload: {
        lead_details: {
          date_of_birth: "1955-03-13",
          consumer_age: "71",
          consumer_age_provenance: "derived_from_date_of_birth",
        },
      },
    }),
    WINDOW
  );
  assert.equal(unchanged.recoveryClass, "unchanged");

  const invalid = assessIncomingDobRecoveryRow(
    snapshot({
      rawPayload: {
        provider: "leadcapture_io",
        sa360_source_system: "leadcapture_io_nextgen",
        parent_url: "https://go.lifeinsuranceforvets.com/learn-julia-dodge",
        date: "02/31/1955",
      },
    }),
    WINDOW
  );
  assert.equal(invalid.recoveryClass, "invalid");
});

test("recovery command refuses writes and remote hosts before printing a report", () => {
  const script = readFileSync(resolve(repoRoot, "scripts/incoming-field-dob-recovery.ts"), "utf8");
  const service = readFileSync(
    resolve(repoRoot, "apps/api/src/services/source-intake/incoming-field-dob-recovery.ts"),
    "utf8"
  );
  assert.equal(script.includes(".update("), false);
  assert.equal(script.includes(".delete("), false);
  assert.equal(service.includes(".update("), false);
  assert.equal(service.includes(".create("), false);

  const run = (args: string[], databaseUrl: string) => {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value != null) env[key] = value;
    }
    delete env.NODE_ENV;
    env.DATABASE_URL = databaseUrl;
    return spawnSync("pnpm", ["exec", "tsx", "scripts/incoming-field-dob-recovery.ts", ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      env,
      shell: true,
      timeout: 20_000,
    });
  };

  const apply = run(["--apply"], "postgresql://sa360:sa360password@127.0.0.1:5432/sa360_test");
  assert.equal(apply.status, 2);
  assert.match(`${apply.stdout}\n${apply.stderr}`, /writes_refused/);
  assert.equal(`${apply.stdout}`.includes(INCOMING_DOB_RECOVERY_REPORT_VERSION), false);

  const remote = run([], "postgresql://user:secret@db.example.com:25060/defaultdb");
  assert.equal(remote.status, 2);
  assert.match(`${remote.stdout}\n${remote.stderr}`, /remote_database_refused/);
  assert.equal(`${remote.stdout}${remote.stderr}`.includes("secret"), false);
});

test("local dry run reads without writing", () => {
  const databaseUrl = assertSafeTestDatabaseUrl(
    process.env.SA360_PPL_INTEGRATION_DATABASE_URL?.trim() || process.env.SA360_TEST_DATABASE_URL
  );
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value != null) env[key] = value;
  }
  delete env.NODE_ENV;
  env.DATABASE_URL = databaseUrl;
  const run = spawnSync("pnpm", ["exec", "tsx", "scripts/incoming-field-dob-recovery.ts", "--limit", "10"], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
    shell: true,
    timeout: 60_000,
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const report = JSON.parse(run.stdout) as { report: string; writes: boolean; knownEvent: { found: boolean } };
  assert.equal(report.report, INCOMING_DOB_RECOVERY_REPORT_VERSION);
  assert.equal(report.writes, false);
  assert.equal(typeof report.knownEvent.found, "boolean");
});
