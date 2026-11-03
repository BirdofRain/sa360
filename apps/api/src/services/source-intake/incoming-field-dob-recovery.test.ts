import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  adminSourceLeadDetailToRecoverySnapshot,
  assessIncomingDobRecoveryRow,
  buildIncomingDobRecoveryReport,
  describeIncomingDobRecoveryExpectation,
  describeIncomingDobRecoveryInspection,
  INCOMING_DOB_LATER_UPDATE_POLICY,
  INCOMING_DOB_RECOVERY_REPORT_VERSION,
  INCOMING_DOB_RECOVERY_WINDOW_END,
  INCOMING_DOB_RECOVERY_WINDOW_START,
  KNOWN_DOB_RECOVERY_EVENT_ID,
  RELEASE_WINDOW_INSPECTION_EVENT_IDS,
  scanAdminSourceLeadWindow,
  type IncomingDobRecoverySnapshot,
} from "./incoming-field-dob-recovery.js";
import {
  CONFIRMED_ERIKS_VEIDEMANIS_PARENT_URL_KEY,
  CONFIRMED_ERIKS_VEIDEMANIS_PROVIDER_FUNNEL_ID,
  CONFIRMED_ERIKS_VEIDEMANIS_SOURCE_LEAD_ID,
  CONFIRMED_JULIA_DODGE_SOURCE_FUNNEL_ID,
} from "./source-field-alias.registry.js";

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
  assert.equal(INCOMING_DOB_LATER_UPDATE_POLICY.implemented, true);
  assert.equal(INCOMING_DOB_LATER_UPDATE_POLICY.timestamps.includes('"updatedAt" = "updatedAt"'), false);
  assert.equal(INCOMING_DOB_LATER_UPDATE_POLICY.timestamps.includes("Let updatedAt move"), true);
  assert.equal(INCOMING_DOB_LATER_UPDATE_POLICY.evidence.includes("before and after"), true);
  assert.equal(INCOMING_DOB_LATER_UPDATE_POLICY.compareAndSet.includes("disagrees"), true);
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

test("Eriks's confirmed page is eligible without using the provider lead id as the event id", () => {
  const row = snapshot({
    id: "evt_internal",
    receivedAt: "2026-11-03T09:53:40.000Z",
    rawPayload: {
      provider: "leadcapture_io",
      sa360_source_system: "leadcapture_io_nextgen",
      lead_id: CONFIRMED_ERIKS_VEIDEMANIS_SOURCE_LEAD_ID,
      submitted_at: "2026-11-03T09:53:33.092Z",
      parent_url: `https://${CONFIRMED_ERIKS_VEIDEMANIS_PARENT_URL_KEY}?utm_source=ad`,
      date: "01/27/1949",
      email: "pat.sample@example.test",
    },
    enrichment: { sourceFunnelId: "cmobservedfunnel0000000000" },
  });
  const assessed = assessIncomingDobRecoveryRow(row, WINDOW);
  assert.equal(assessed.recoveryClass, "eligible");
  assert.equal(assessed.dateMeansBirthday, true);
  assert.notEqual(assessed.id, CONFIRMED_ERIKS_VEIDEMANIS_SOURCE_LEAD_ID);
  const wrongPage = assessIncomingDobRecoveryRow(
    snapshot({
      rawPayload: {
        provider: "leadcapture_io",
        sa360_source_system: "leadcapture_io_nextgen",
        parent_url: `https://${CONFIRMED_ERIKS_VEIDEMANIS_PARENT_URL_KEY}/extra`,
        date: "01/27/1949",
      },
      enrichment: { sourceFunnelId: CONFIRMED_ERIKS_VEIDEMANIS_PROVIDER_FUNNEL_ID },
    }),
    WINDOW
  );
  assert.equal(wrongPage.recoveryClass, "skipped");
  assert.equal(wrongPage.reason, "not_confirmed_form");

  const mismatchedFunnel = assessIncomingDobRecoveryRow(
    snapshot({
      rawPayload: {
        ...(row.rawPayload as Record<string, unknown>),
        funnel_id: "11111111-2222-4333-8444-666666666666",
      },
      enrichment: { sourceFunnelId: "cmobservedfunnel0000000000" },
    }),
    WINDOW
  );
  assert.equal(mismatchedFunnel.recoveryClass, "skipped");
  assert.equal(mismatchedFunnel.reason, "not_confirmed_form");

  const crossForm = assessIncomingDobRecoveryRow(
    snapshot({
      rawPayload: row.rawPayload,
      enrichment: { sourceFunnelId: CONFIRMED_JULIA_DODGE_SOURCE_FUNNEL_ID },
    }),
    WINDOW
  );
  assert.equal(crossForm.recoveryClass, "skipped");
  assert.equal(crossForm.reason, "not_confirmed_form");
});

test("known-event expectation recomputes canonical DOB and age without contact fields", () => {
  const row = snapshot({ id: KNOWN_DOB_RECOVERY_EVENT_ID, rawPayload: { ...(snapshot().rawPayload as object), date: "03/13/1955" } });
  const expectation = describeIncomingDobRecoveryExpectation(row);
  assert.ok(expectation);
  assert.equal(expectation.dateOfBirth, "1955-03-13");
  assert.equal(expectation.consumerAge, "71");
  assert.equal(expectation.referenceDate, "2026-11-02");
  assert.equal(expectation.provenance, "derived_from_date_of_birth");
  assert.equal(expectation.conflict, false);
  assert.equal(expectation.proposedRecoveryIsProductionVerification, false);
  assert.equal(JSON.stringify(expectation).includes("pat.sample@example.test"), false);
  assert.equal(JSON.stringify(expectation).includes("03/13/1955"), false);
});

test("a specific inspection keeps the raw birthday distinct from receipt time and omits contact fields", () => {
  const row = snapshot({
    receivedAt: "2026-11-03T15:06:17.000Z",
    normalizedPayload: {
      lead_details: {
        consumer_age: "40",
        consumer_age_provenance: "supplied",
        consumer_age_reference_date: "2026-11-03",
      },
      routing: { source_intake: { submitted_at: "2026-11-03T15:06:00.000Z" } },
      contact: { email: "pat.sample@example.test", first_name: "Pat" },
    },
  });
  const inspection = describeIncomingDobRecoveryInspection(row);
  assert.equal(inspection.rawDate, "03/13/1955");
  assert.equal(inspection.rawDateCount, 1);
  assert.equal(inspection.submittedAt, "2026-11-03T15:06:00.000Z");
  assert.equal(inspection.receivedAt, "2026-11-03T15:06:17.000Z");
  assert.notEqual(inspection.submittedAt, inspection.receivedAt);
  assert.equal(inspection.parentUrlKey, "go.lifeinsuranceforvets.com/learn-julia-dodge");
  assert.equal(inspection.sourceSystem, "leadcapture_io_nextgen");
  assert.equal(inspection.storedCanonical.dateOfBirth, null);
  assert.equal(inspection.storedCanonical.consumerAge, "40");
  assert.equal(inspection.storedCanonical.consumerAgeProvenance, "supplied");
  assert.equal(inspection.storedCanonical.referenceDate, "2026-11-03");
  assert.equal(inspection.proposedRecovery?.dateOfBirth, "1955-03-13");
  assert.equal(inspection.proposedRecovery?.consumerAge, "71");
  assert.equal(inspection.proposedRecovery?.proposedRecoveryIsProductionVerification, false);
  assert.equal("expectation" in inspection, false);
  const printed = JSON.stringify(inspection);
  assert.equal(printed.includes("pat.sample@example.test"), false);
  assert.equal(printed.includes("Pat"), false);
});

test("admin list scan stops at the window and does not invent sheet delivery", async () => {
  const pages = [
    {
      items: [
        { id: "new", receivedAt: "2026-11-02T12:00:00.000Z", sourceProvider: "leadcapture_io" },
        { id: "edge", receivedAt: "2026-10-26T04:00:00.000Z", sourceProvider: "leadcapture_io" },
      ],
      nextCursor: "edge",
    },
    {
      items: [{ id: "old", receivedAt: "2026-10-25T12:00:00.000Z", sourceProvider: "leadcapture_io" }],
      nextCursor: "old",
    },
  ];
  let calls = 0;
  const scan = await scanAdminSourceLeadWindow({
    receivedFrom: INCOMING_DOB_RECOVERY_WINDOW_START,
    receivedTo: "2026-11-03T15:00:00.000Z",
    maxPages: 5,
    listPage: async () => pages[calls++] ?? { items: [], nextCursor: null },
  });
  assert.equal(calls, 2);
  assert.deepEqual(scan.ids, ["new", "edge"]);
  assert.equal(scan.complete, true);
  assert.equal(scan.stoppedReason, "window_crossed");

  const capped = await scanAdminSourceLeadWindow({
    receivedFrom: INCOMING_DOB_RECOVERY_WINDOW_START,
    receivedTo: null,
    maxPages: 1,
    listPage: async () => ({
      items: [{ id: "only", receivedAt: "2026-11-02T12:00:00.000Z", sourceProvider: "leadcapture_io" }],
      nextCursor: "only",
    }),
  });
  assert.equal(capped.complete, false);
  assert.equal(capped.stoppedReason, "page_cap");

  const mapped = adminSourceLeadDetailToRecoverySnapshot({
    id: "evt_detail",
    sourceProvider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    status: "delivery_failed",
    receivedAt: "2026-11-02T12:00:00.000Z",
    destinationClientAccountId: "client_dest",
    rawPayloadJson: { email: "hidden@example.test" },
    deliveryResultJson: { externalCallExecuted: true },
  });
  assert.equal(mapped.ghlDelivered, true);
  assert.equal(mapped.sheetsDelivered, false);
  assert.equal(mapped.commerciallyAllocated, false);
  assert.equal(mapped.clientAccountId, "client_dest");
  const printed = JSON.stringify(
    buildIncomingDobRecoveryReport({
      rows: [mapped],
      receivedFrom: INCOMING_DOB_RECOVERY_WINDOW_START,
      receivedTo: null,
    })
  );
  assert.equal(printed.includes("hidden@example.test"), false);
});

test("admin recovery command refuses writes and a missing key before any request", () => {
  const script = readFileSync(resolve(repoRoot, "scripts/incoming-field-dob-recovery-admin.ts"), "utf8");
  assert.equal(script.includes('method: "GET"'), true);
  assert.equal(script.includes("POST"), false);
  assert.equal(script.includes(".update("), false);
  assert.equal(script.includes(".delete("), false);
  assert.equal(script.includes("knownEventExpectation"), false);
  assert.equal(script.includes("INCOMING_DOB_RECOVERY_WINDOW_END"), true);
  assert.equal(script.includes("RELEASE_WINDOW_INSPECTION_EVENT_IDS"), true);
  assert.equal(script.includes("missingInspectionIds"), true);
  assert.equal(script.includes("KNOWN_DOB_RECOVERY_EVENT_ID"), true);
  assert.equal(INCOMING_DOB_RECOVERY_WINDOW_END, "2026-11-03T15:36:00.000Z");
  assert.deepEqual(
    [...RELEASE_WINDOW_INSPECTION_EVENT_IDS],
    [
      "cmw0tfpgl0001jv0tp3bk0kz1",
      "cmw0tlwqv000fjv0te77z8c2x",
      "cmw0tng0m000tjv0t1cfwreyt",
      "cmw0tyaw30015jv0tcj17bkhe",
      "cmw0u7gyn001xjv0tfubwz6tz",
      "cmw0u8hbx002bjv0t0nas5wot",
    ]
  );

  const run = (args: string[]) => {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value != null) env[key] = value;
    }
    delete env.NODE_ENV;
    delete env.ADMIN_API_KEY;
    delete env.SA360_ADMIN_KEY;
    delete env.SA360_PROD_API_URL;
    return spawnSync("pnpm", ["exec", "tsx", "scripts/incoming-field-dob-recovery-admin.ts", ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      env,
      shell: true,
      timeout: 20_000,
    });
  };

  const apply = run(["--apply", "--base-url", "https://example.test"]);
  assert.equal(apply.status, 2);
  assert.match(`${apply.stdout}\n${apply.stderr}`, /writes_refused/);

  const missing = run(["--base-url", "https://example.test"]);
  assert.equal(missing.status, 2);
  assert.match(`${missing.stdout}\n${missing.stderr}`, /admin_key_required/);
  assert.equal(`${missing.stdout}`.includes(INCOMING_DOB_RECOVERY_REPORT_VERSION), false);
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
