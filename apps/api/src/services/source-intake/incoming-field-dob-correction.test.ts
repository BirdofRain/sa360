import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Prisma, PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  INCOMING_DOB_RECOVERY_WINDOW_START,
  type IncomingDobRecoverySnapshot,
} from "./incoming-field-dob-recovery.js";
import {
  INCOMING_DOB_CORRECTION_APPLY_CONFIRMATION,
  INCOMING_DOB_CORRECTION_ROLLBACK_CONFIRMATION,
  applyIncomingDobCorrections,
  planIncomingDobCorrection,
  readCanonicalDobAgeState,
  readDobCorrectionAudits,
  rollbackIncomingDobCorrections,
  selectDobCorrectionRollbackTargets,
} from "./incoming-field-dob-correction.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const WINDOW = { receivedFrom: INCOMING_DOB_RECOVERY_WINDOW_START, receivedTo: null };
const EMAIL = "pat.sample@example.test";

function snapshot(overrides: Partial<IncomingDobRecoverySnapshot> = {}): IncomingDobRecoverySnapshot {
  return {
    id: "evt_synthetic",
    sourceProvider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    sourceRouteKey: "LCIO_NEXTGEN_VET_SYNTHETIC",
    sourceFunnelName: "Synthetic veteran",
    clientAccountId: "client_synthetic",
    status: "received",
    receivedAt: "2026-11-02T18:00:00.000Z",
    deliveredAt: null,
    rawPayload: {
      provider: "leadcapture_io",
      sa360_source_system: "leadcapture_io_nextgen",
      lead_id: "11111111-2222-4333-8444-555555555555",
      submitted_at: "2026-11-02T18:00:00.000Z",
      parent_url: "https://go.lifeinsuranceforvets.com/learn-julia-dodge",
      first_name: "Pat",
      email: EMAIL,
      date: "03/13/1955",
    },
    normalizedPayload: {
      contact: { email: EMAIL, first_name: "Pat" },
      lead_details: { coverage_note: "keep-me" },
      routing: {
        niche_key: "vet",
        source_intake: {
          submitted_at: "2026-11-02T18:00:00.000Z",
          sourceAttributes: { branch: "Army" },
        },
      },
    },
    enrichment: null,
    routingResult: null,
    sheetsDelivered: false,
    ghlDelivered: false,
    commerciallyAllocated: false,
    ...overrides,
  };
}

test("a blank confirmed canonical DOB is filled and a supplied age disagreement is not", () => {
  const plan = planIncomingDobCorrection(snapshot(), WINDOW);
  assert.equal(plan.action, "apply");
  assert.equal(plan.after.date_of_birth, "1955-03-13");
  assert.equal(plan.after.consumer_age, "71");
  assert.equal(plan.after.consumer_age_provenance, "derived_from_date_of_birth");
  assert.equal(plan.after.source_attribute_date_of_birth, "03/13/1955");
  assert.equal(JSON.stringify(plan).includes(EMAIL), false);

  const conflict = planIncomingDobCorrection(
    snapshot({
      normalizedPayload: {
        ...(snapshot().normalizedPayload as object),
        lead_details: { consumer_age: "40", coverage_note: "keep-me" },
      },
    }),
    WINDOW
  );
  assert.equal(conflict.action, "skip");
  assert.equal(conflict.recoveryClass, "conflicting");
  assert.equal(conflict.before.consumer_age, "40");
  assert.equal(conflict.after.consumer_age, "40");

  const healthcare = planIncomingDobCorrection(
    snapshot({
      rawPayload: {
        provider: "leadcapture_io",
        sa360_source_system: "leadcapture_io_nextgen",
        parent_url: "https://go.lifeinsuranceforvets.com/learn-julia-healthcare-worker",
        date: "03/13/1955",
        email: EMAIL,
      },
    }),
    WINDOW
  );
  assert.equal(healthcare.action, "skip");
  assert.equal(healthcare.reason, "not_confirmed_form");

  const preservedAttribute = planIncomingDobCorrection(
    snapshot({
      normalizedPayload: {
        contact: { email: EMAIL },
        lead_details: { coverage_note: "keep-me" },
        routing: {
          niche_key: "vet",
          source_intake: {
            submitted_at: "2026-11-02T18:00:00.000Z",
            sourceAttributes: { branch: "Army", date_of_birth: "keep-raw" },
          },
        },
      },
    }),
    WINDOW
  );
  assert.equal(preservedAttribute.action, "apply");
  assert.equal(preservedAttribute.after.date_of_birth, "1955-03-13");
  assert.equal(preservedAttribute.after.source_attribute_date_of_birth, "keep-raw");
});

test("rollback selection closes an apply and ignores contact text", () => {
  const apply = {
    version: "incoming_field_dob_correction_v1" as const,
    action: "apply" as const,
    operator: "correction-test",
    eventId: "evt_a",
    previousUpdatedAt: "2026-11-02T18:00:00.000Z",
    newUpdatedAt: "2026-11-03T15:00:00.000Z",
    alreadyDelivered: true,
    before: readCanonicalDobAgeState({}),
    after: readCanonicalDobAgeState({ lead_details: { date_of_birth: "1955-03-13", consumer_age: "71" } }),
    externalDestinations: "unchanged" as const,
  };
  assert.equal(selectDobCorrectionRollbackTargets([apply]).length, 1);
  assert.equal(selectDobCorrectionRollbackTargets([{ ...apply, action: "rollback" }]).length, 0);
  assert.equal(JSON.stringify(apply).includes(EMAIL), false);
});

test("apply fills only blank canonical fields, is idempotent, and rolls back", async () => {
  const databaseUrl = assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const holder = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const auditFile = join(mkdtempSync(join(tmpdir(), "dob-correction-")), "run.dob-correction-audit.jsonl");
  const created: string[] = [];
  const base = {
    databaseUrl,
    expectedDbHost: "127.0.0.1:5432",
    operator: "correction-test",
    confirm: INCOMING_DOB_CORRECTION_APPLY_CONFIRMATION,
    limit: 10,
    auditFile,
    receivedFrom: WINDOW.receivedFrom,
    receivedTo: WINDOW.receivedTo,
  };

  function payload(rawParent: string, details: Record<string, string>) {
    return {
      rawPayloadJson: {
        provider: "leadcapture_io",
        sa360_source_system: "leadcapture_io_nextgen",
        lead_id: "11111111-2222-4333-8444-555555555555",
        submitted_at: "2026-11-02T18:00:00.000Z",
        parent_url: rawParent,
        first_name: "Pat",
        email: EMAIL,
        date: "03/13/1955",
      },
      normalizedPayloadJson: {
        contact: { email: EMAIL, first_name: "Pat" },
        lead_details: details,
        routing: {
          niche_key: "vet",
          source_intake: {
            submitted_at: "2026-11-02T18:00:00.000Z",
            sourceAttributes: { branch: "Army" },
          },
        },
      },
    } satisfies { rawPayloadJson: Prisma.InputJsonValue; normalizedPayloadJson: Prisma.InputJsonValue };
  }

  try {
    const eligible = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "webhook",
        sourceLeadId: `dob-correction-${Date.now()}`,
        status: "received",
        receivedAt: new Date("2026-11-02T18:00:00.000Z"),
        normalizedAt: new Date("2026-11-02T18:00:05.000Z"),
        ...payload("https://go.lifeinsuranceforvets.com/learn-julia-dodge", { coverage_note: "keep-me" }),
      },
    });
    created.push(eligible.id);
    const conflict = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "webhook",
        sourceLeadId: `dob-conflict-${Date.now()}`,
        status: "received",
        receivedAt: new Date("2026-11-02T18:00:00.000Z"),
        ...payload("https://go.lifeinsuranceforvets.com/learn-julia-dodge", {
          consumer_age: "40",
          coverage_note: "keep-me",
        }),
      },
    });
    created.push(conflict.id);
    const lockedRow = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "webhook",
        sourceLeadId: `dob-lock-${Date.now()}`,
        status: "received",
        receivedAt: new Date("2026-11-02T18:00:00.000Z"),
        ...payload("https://go.lifeinsuranceforvets.com/learn-julia-dodge", { coverage_note: "keep-me" }),
      },
    });
    created.push(lockedRow.id);

    const refused = await applyIncomingDobCorrections(db, {
      ...base,
      expectedDbHost: "db.example.com",
      ids: [eligible.id],
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.writesAttempted, false);
    assert.equal(refused.reasonCode, "db_host_mismatch");

    const applied = await applyIncomingDobCorrections(db, { ...base, ids: [eligible.id, conflict.id] });
    assert.deepEqual(applied.writtenIds, [eligible.id]);
    assert.equal(applied.externalDestinations, "unchanged");
    const stored = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: eligible.id } });
    const state = readCanonicalDobAgeState(stored.normalizedPayloadJson);
    assert.equal(state.date_of_birth, "1955-03-13");
    assert.equal(state.consumer_age, "71");
    assert.equal(state.consumer_age_provenance, "derived_from_date_of_birth");
    assert.equal(state.source_attribute_date_of_birth, "03/13/1955");
    const normalized = stored.normalizedPayloadJson as {
      contact: { email: string };
      lead_details: { coverage_note: string };
      routing: { niche_key: string; source_intake: { sourceAttributes: { branch: string } } };
    };
    assert.equal(normalized.contact.email, EMAIL);
    assert.equal(normalized.lead_details.coverage_note, "keep-me");
    assert.equal(normalized.routing.niche_key, "vet");
    assert.equal(normalized.routing.source_intake.sourceAttributes.branch, "Army");
    assert.equal(stored.receivedAt.toISOString(), "2026-11-02T18:00:00.000Z");
    assert.equal(stored.normalizedAt?.toISOString(), "2026-11-02T18:00:05.000Z");
    assert.equal(stored.deliveredAt, null);
    assert.equal(stored.status, "received");
    assert.equal((stored.rawPayloadJson as { email: string }).email, EMAIL);
    const conflictStored = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: conflict.id } });
    assert.equal(readCanonicalDobAgeState(conflictStored.normalizedPayloadJson).consumer_age, "40");
    assert.equal(readCanonicalDobAgeState(conflictStored.normalizedPayloadJson).date_of_birth, null);

    const again = await applyIncomingDobCorrections(db, { ...base, ids: [eligible.id] });
    assert.deepEqual(again.writtenIds, []);
    assert.equal(again.skipped[0]?.reason, "already_canonical");
    const audits = readDobCorrectionAudits(auditFile);
    assert.equal(audits.length, 1);
    assert.equal(audits[0]?.before.date_of_birth, null);
    assert.equal(audits[0]?.after.date_of_birth, "1955-03-13");
    assert.equal(JSON.stringify(audits).includes(EMAIL), false);
    assert.equal(JSON.stringify(audits).includes("03/13/1955"), true);

    let release: () => void = () => undefined;
    const releaseHold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markLocked: () => void = () => undefined;
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    const holding = holder.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "SourceLeadEvent" WHERE id = ${lockedRow.id} FOR UPDATE`);
      markLocked();
      await releaseHold;
    }, { timeout: 20_000 });
    await locked;
    const blocked = await applyIncomingDobCorrections(db, { ...base, ids: [lockedRow.id] });
    assert.deepEqual(blocked.writtenIds, []);
    assert.deepEqual(blocked.lockedIds, [lockedRow.id]);
    release();
    await holding;
    const afterLock = await applyIncomingDobCorrections(db, { ...base, ids: [lockedRow.id] });
    assert.deepEqual(afterLock.writtenIds, [lockedRow.id]);

    const rolled = await rollbackIncomingDobCorrections(db, {
      ...base,
      confirm: INCOMING_DOB_CORRECTION_ROLLBACK_CONFIRMATION,
    });
    assert.equal(rolled.writtenIds.includes(eligible.id), true);
    const restored = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: eligible.id } });
    const restoredState = readCanonicalDobAgeState(restored.normalizedPayloadJson);
    assert.equal(restoredState.date_of_birth, null);
    assert.equal(restoredState.consumer_age, null);
    assert.equal(restoredState.source_attribute_date_of_birth, null);
    const restoredPayload = restored.normalizedPayloadJson as {
      contact: { email: string };
      lead_details: { coverage_note: string };
      routing: { source_intake: { sourceAttributes: { branch: string } } };
    };
    assert.equal(restoredPayload.contact.email, EMAIL);
    assert.equal(restoredPayload.lead_details.coverage_note, "keep-me");
    assert.equal(restoredPayload.routing.source_intake.sourceAttributes.branch, "Army");
    assert.equal(restored.receivedAt.toISOString(), "2026-11-02T18:00:00.000Z");

    const rolledAgain = await rollbackIncomingDobCorrections(db, {
      ...base,
      confirm: INCOMING_DOB_CORRECTION_ROLLBACK_CONFIRMATION,
    });
    assert.deepEqual(rolledAgain.writtenIds, []);
  } finally {
    if (created.length > 0) {
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: created } } });
    }
    await db.$disconnect();
    await holder.$disconnect();
  }
});

test("correction command dry-run does not write and refuses a remote host", () => {
  const databaseUrl = assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const run = (args: string[], url: string) => {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value != null) env[key] = value;
    }
    delete env.NODE_ENV;
    env.DATABASE_URL = url;
    return spawnSync("pnpm", ["exec", "tsx", "scripts/incoming-field-dob-correction.ts", ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      env,
      shell: true,
      timeout: 60_000,
    });
  };

  const dry = run(["--limit", "5"], databaseUrl);
  assert.equal(dry.status, 0, `${dry.stdout}\n${dry.stderr}`);
  const report = JSON.parse(dry.stdout) as { mode: string; writes: boolean };
  assert.equal(report.mode, "dry_run");
  assert.equal(report.writes, false);

  const remote = run([], "postgresql://user:secret@db.example.com:25060/defaultdb");
  assert.equal(remote.status, 2);
  assert.match(`${remote.stdout}\n${remote.stderr}`, /remote_database_refused/);
  assert.equal(`${remote.stdout}${remote.stderr}`.includes("secret"), false);

  const apply = run(["--apply", "--expected-db-host", "127.0.0.1:5432", "--limit", "1"], databaseUrl);
  assert.equal(apply.status, 2);
  assert.match(`${apply.stdout}\n${apply.stderr}`, /confirmation_phrase_mismatch|confirmation_mismatch/);
});
