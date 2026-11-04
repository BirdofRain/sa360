import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Prisma, PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { confirmedDateOfBirthBindings, CONFIRMED_CATALOG_DOB_FORMS } from "./source-field-alias.registry.js";
import {
  INCOMING_DOB_RECOVERY_WINDOW_END,
  INCOMING_DOB_RECOVERY_WINDOW_START,
  type IncomingDobRecoverySnapshot,
} from "./incoming-field-dob-recovery.js";
import {
  INCOMING_DOB_CORRECTION_APPLY_CONFIRMATION,
  INCOMING_DOB_CORRECTION_AUDIT_DDL,
  INCOMING_DOB_CORRECTION_ROLLBACK_CONFIRMATION,
  applyIncomingDobCorrections,
  incomingDobCorrectionExitCode,
  planIncomingDobCorrection,
  readCanonicalDobAgeState,
  readDobCorrectionAudits,
  readDobCorrectionAuditsFromDb,
  rollbackIncomingDobCorrections,
  selectDobCorrectionRollbackTargets,
  type CanonicalDobAgeState,
  type DobCorrectionWriteResult,
} from "./incoming-field-dob-correction.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const WINDOW = {
  receivedFrom: INCOMING_DOB_RECOVERY_WINDOW_START,
  receivedTo: INCOMING_DOB_RECOVERY_WINDOW_END,
};
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

test("Eriks's confirmed page plans 1949-01-27 and age 77", () => {
  const plan = planIncomingDobCorrection(
    snapshot({
      id: "evt_internal_eriks",
      receivedAt: "2026-11-03T09:53:33.092Z",
      rawPayload: {
        provider: "leadcapture_io",
        sa360_source_system: "leadcapture_io_nextgen",
        lead_id: "e452eaed-92c8-4916-9dd1-fbd001dafaac",
        submitted_at: "2026-11-03T09:53:33.092Z",
        parent_url: "https://go.lifeinsuranceforvets.com/learn-eriks-veidemanis?utm=1",
        first_name: "Pat",
        email: EMAIL,
        date: "01/27/1949",
      },
      normalizedPayload: {
        contact: { email: EMAIL, first_name: "Pat" },
        lead_details: {},
        routing: {
          niche_key: "vet",
          source_intake: {
            submitted_at: "2026-11-03T09:53:33.092Z",
            sourceAttributes: {},
          },
        },
      },
      enrichment: { sourceFunnelId: "cmobservedfunnel0000000000" },
    }),
    WINDOW
  );
  assert.equal(plan.action, "apply");
  assert.equal(plan.after.date_of_birth, "1949-01-27");
  assert.equal(plan.after.consumer_age, "77");
  assert.equal(plan.after.consumer_age_reference_date, "2026-11-03");
  assert.notEqual(plan.eventId, "e452eaed-92c8-4916-9dd1-fbd001dafaac");
});

test("rows outside the fixed window are not corrections", () => {
  const afterEnd = planIncomingDobCorrection(snapshot({ receivedAt: "2026-11-03T15:36:00.001Z" }), WINDOW);
  assert.equal(afterEnd.action, "skip");
  assert.equal(afterEnd.reason, "outside_window");
  const beforeStart = planIncomingDobCorrection(snapshot({ receivedAt: "2026-10-26T03:59:59.999Z" }), WINDOW);
  assert.equal(beforeStart.action, "skip");
  assert.equal(beforeStart.reason, "outside_window");
  const included = planIncomingDobCorrection(snapshot({ receivedAt: "2026-11-03T15:36:00.000Z" }), WINDOW);
  assert.equal(included.action, "apply");
});

test("a refused correction exits 2 and a pending correction exits 3", () => {
  const result = (overrides: Partial<DobCorrectionWriteResult>): DobCorrectionWriteResult => ({
    version: "incoming_field_dob_correction_v1",
    outcome: "NOOP",
    ok: true,
    writesAttempted: true,
    complete: true,
    writtenIds: [],
    pendingIds: [],
    lockedIds: [],
    skipped: [],
    counts: { requested: 0, written: 0, skipped: 0, pending: 0 },
    auditExportFailed: false,
    auditRelation: "IncomingDobCorrectionAudit",
    externalDestinations: "unchanged",
    ...overrides,
  });
  assert.equal(incomingDobCorrectionExitCode(result({ ok: false, complete: false, outcome: "REFUSED" })), 2);
  assert.equal(incomingDobCorrectionExitCode(result({ ok: true, complete: false, outcome: "PENDING" })), 3);
  assert.equal(incomingDobCorrectionExitCode(result({ ok: true, complete: true, outcome: "APPLIED" })), 0);
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

async function dropAuditTable(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe('DROP TABLE IF EXISTS "IncomingDobCorrectionAudit"');
}

async function createAuditTable(db: PrismaClient): Promise<void> {
  await dropAuditTable(db);
  for (const statement of INCOMING_DOB_CORRECTION_AUDIT_DDL) {
    await db.$executeRawUnsafe(statement);
  }
}

test("apply fills only blank canonical fields, is idempotent, and rolls back", async () => {
  const databaseUrl = assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const holder = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const restarted = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
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

  const blank: CanonicalDobAgeState = readCanonicalDobAgeState({
    lead_details: { coverage_note: "keep-me" },
    routing: { source_intake: { sourceAttributes: { branch: "Army" } } },
  });
  let releaseHold: () => void = () => undefined;
  let holding: Promise<unknown> | null = null;

  try {
    await dropAuditTable(db);
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

    const hostMismatch = await applyIncomingDobCorrections(db, {
      ...base,
      expectedDbHost: "db.example.com",
      ids: [eligible.id],
      expectedCount: 1,
    });
    assert.equal(hostMismatch.ok, false);
    assert.equal(hostMismatch.writesAttempted, false);
    assert.equal(hostMismatch.reasonCode, "db_host_mismatch");

    const counted = await applyIncomingDobCorrections(db, {
      ...base,
      ids: [eligible.id, eligible.id],
      expectedCount: 2,
    });
    assert.equal(counted.ok, false);
    assert.equal(counted.writesAttempted, false);
    assert.equal(counted.reasonCode, "reviewed_count_mismatch");
    assert.equal(readCanonicalDobAgeState(
      (await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: eligible.id } })).normalizedPayloadJson
    ).date_of_birth, null);

    const refused = await applyIncomingDobCorrections(db, { ...base, ids: [eligible.id], expectedCount: 1 });
    assert.equal(refused.ok, false);
    assert.equal(refused.writesAttempted, false);
    assert.equal(refused.reasonCode, "audit_relation_required");
    assert.equal(readCanonicalDobAgeState(
      (await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: eligible.id } })).normalizedPayloadJson
    ).date_of_birth, null);

    await db.$executeRawUnsafe('CREATE TABLE "IncomingDobCorrectionAudit" (id TEXT PRIMARY KEY)');
    const incompatible = await applyIncomingDobCorrections(db, {
      ...base,
      ids: [eligible.id],
      expectedCount: 1,
    });
    assert.equal(incompatible.ok, false);
    assert.equal(incompatible.writesAttempted, false);
    assert.equal(incompatible.reasonCode, "audit_relation_incompatible");
    assert.equal(readCanonicalDobAgeState(
      (await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: eligible.id } })).normalizedPayloadJson
    ).date_of_birth, null);
    await dropAuditTable(db);

    await createAuditTable(db);
    await assert.rejects(
      () => applyIncomingDobCorrections(db, {
        ...base,
        ids: [eligible.id],
        expectedCount: 1,
        expectedBeforeById: { [eligible.id]: blank },
        beforeCommit: () => {
          throw new Error("terminated_before_commit");
        },
      }),
      /terminated_before_commit/
    );
    assert.equal(readCanonicalDobAgeState(
      (await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: eligible.id } })).normalizedPayloadJson
    ).date_of_birth, null);
    assert.equal((await readDobCorrectionAuditsFromDb(db)).length, 0);

    const applied = await applyIncomingDobCorrections(db, {
      ...base,
      ids: [eligible.id, conflict.id],
      expectedCount: 2,
      expectedBeforeById: {
        [eligible.id]: blank,
        [conflict.id]: { ...blank, consumer_age: "40" },
      },
    });
    assert.equal(applied.complete, true);
    assert.equal(applied.outcome, "APPLIED");
    assert.deepEqual(applied.pendingIds, []);
    assert.equal(applied.counts.requested, applied.counts.written + applied.counts.skipped + applied.counts.pending);
    assert.deepEqual(applied.writtenIds, [eligible.id]);
    assert.equal(applied.externalDestinations, "unchanged");
    const stored = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: eligible.id } });
    const state = readCanonicalDobAgeState(stored.normalizedPayloadJson);
    assert.equal(state.date_of_birth, "1955-03-13");
    assert.equal(state.date_of_birth_provenance, "supplied");
    assert.equal(state.consumer_age, "71");
    assert.equal(state.consumer_age_provenance, "derived_from_date_of_birth");
    assert.equal(state.consumer_age_reference_date, "2026-11-02");
    assert.equal(state.consumer_age_reference_rule, "submitted_at_utc_date_else_received_at_utc_date");
    assert.equal(state.consumer_age_conflict, null);
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

    const again = await applyIncomingDobCorrections(db, { ...base, ids: [eligible.id], expectedCount: 1 });
    assert.deepEqual(again.writtenIds, []);
    assert.equal(again.skipped[0]?.reason, "already_canonical");
    const audits = readDobCorrectionAudits(auditFile);
    assert.equal(audits.length, 1);
    assert.equal(audits[0]?.before.date_of_birth, null);
    assert.equal(audits[0]?.after.date_of_birth, "1955-03-13");
    assert.equal(audits[0]?.after.source_attribute_date_of_birth, "03/13/1955");
    assert.equal(JSON.stringify(audits).includes(EMAIL), false);
    const durable = await readDobCorrectionAuditsFromDb(db);
    assert.equal(durable.length, 1);
    assert.equal(durable[0]?.eventId, eligible.id);
    assert.equal(JSON.stringify(durable).includes(EMAIL), false);

    let markLocked: () => void = () => undefined;
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    holding = holder.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "SourceLeadEvent" WHERE id = ${lockedRow.id} FOR UPDATE`);
      markLocked();
      await released;
    }, { timeout: 20_000 });
    await locked;
    const blocked = await applyIncomingDobCorrections(db, {
      ...base,
      ids: [lockedRow.id],
      expectedCount: 1,
      expectedBeforeById: { [lockedRow.id]: blank },
    });
    assert.deepEqual(blocked.writtenIds, []);
    assert.deepEqual(blocked.pendingIds, [lockedRow.id]);
    assert.equal(blocked.outcome, "PENDING");
    assert.equal(blocked.complete, false);
    assert.equal(blocked.counts.requested, 1);
    assert.equal(blocked.counts.pending, 1);
    assert.equal(blocked.counts.written + blocked.counts.skipped + blocked.counts.pending, blocked.counts.requested);
    assert.equal(blocked.skipped.some((row) => row.id === lockedRow.id), false);
    releaseHold();
    await holding;
    holding = null;
    const afterLock = await applyIncomingDobCorrections(db, {
      ...base,
      ids: [lockedRow.id],
      expectedCount: 1,
      expectedBeforeById: { [lockedRow.id]: blank },
    });
    assert.equal(afterLock.complete, true);
    assert.deepEqual(afterLock.writtenIds, [lockedRow.id]);

    const edited = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "webhook",
        sourceLeadId: `dob-edited-${Date.now()}`,
        status: "received",
        receivedAt: new Date("2026-11-02T18:00:00.000Z"),
        ...payload("https://go.lifeinsuranceforvets.com/learn-julia-dodge", { coverage_note: "keep-me" }),
      },
    });
    created.push(edited.id);
    const editedApply = await applyIncomingDobCorrections(db, {
      ...base,
      ids: [edited.id],
      expectedCount: 1,
      expectedBeforeById: { [edited.id]: blank },
    });
    assert.deepEqual(editedApply.writtenIds, [edited.id]);
    const editedStored = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: edited.id } });
    const editedPayload = structuredClone(editedStored.normalizedPayloadJson) as {
      contact: { email: string };
      lead_details: Record<string, unknown>;
      routing: { niche_key: string; source_intake: { sourceAttributes: Record<string, string> } };
    };
    editedPayload.lead_details.consumer_age = "55";
    await db.sourceLeadEvent.update({
      where: { id: edited.id },
      data: { normalizedPayloadJson: editedPayload as Prisma.InputJsonValue },
    });

    const outside = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "webhook",
        sourceLeadId: `dob-outside-${Date.now()}`,
        status: "received",
        receivedAt: new Date("2026-11-03T16:00:00.000Z"),
        ...payload("https://go.lifeinsuranceforvets.com/learn-julia-dodge", { coverage_note: "keep-me" }),
      },
    });
    created.push(outside.id);
    const drifted = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "webhook",
        sourceLeadId: `dob-drift-${Date.now()}`,
        status: "received",
        receivedAt: new Date("2026-11-02T18:00:00.000Z"),
        ...payload("https://go.lifeinsuranceforvets.com/learn-julia-dodge", { coverage_note: "keep-me" }),
      },
    });
    created.push(drifted.id);
    const blockedExport = join(mkdtempSync(join(tmpdir(), "dob-correction-")), "blocker");
    writeFileSync(blockedExport, "not-a-directory");
    const exportRow = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "webhook",
        sourceLeadId: `dob-export-${Date.now()}`,
        status: "received",
        receivedAt: new Date("2026-11-02T18:00:00.000Z"),
        ...payload("https://go.lifeinsuranceforvets.com/learn-julia-dodge", { coverage_note: "keep-me" }),
      },
    });
    created.push(exportRow.id);
    const scope = await applyIncomingDobCorrections(db, {
      ...base,
      ids: [outside.id, drifted.id],
      expectedCount: 2,
      expectedBeforeById: {
        [outside.id]: blank,
        [drifted.id]: { ...blank, date_of_birth: "1900-01-01" },
      },
    });
    assert.equal(scope.complete, true);
    assert.deepEqual(scope.writtenIds, []);
    assert.equal(scope.skipped.find((row) => row.id === outside.id)?.reason, "outside_window");
    assert.equal(scope.skipped.find((row) => row.id === drifted.id)?.reason, "changed_under_lock");
    assert.equal(readCanonicalDobAgeState(
      (await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: drifted.id } })).normalizedPayloadJson
    ).date_of_birth, null);

    const exported = await applyIncomingDobCorrections(db, {
      ...base,
      auditFile: join(blockedExport, "lost.dob-correction-audit.jsonl"),
      ids: [exportRow.id],
      expectedCount: 1,
      expectedBeforeById: { [exportRow.id]: blank },
    });
    assert.equal(exported.ok, true);
    assert.equal(exported.auditExportFailed, true);
    assert.deepEqual(exported.writtenIds, [exportRow.id]);
    assert.equal((await readDobCorrectionAuditsFromDb(db)).some((row) => row.eventId === exportRow.id), true);

    await db.$disconnect();
    const rolled = await rollbackIncomingDobCorrections(restarted, {
      ...base,
      auditFile: "",
      confirm: INCOMING_DOB_CORRECTION_ROLLBACK_CONFIRMATION,
    });
    assert.equal(rolled.complete, true);
    assert.equal(rolled.outcome, "ROLLED_BACK");
    assert.equal(rolled.writtenIds.includes(eligible.id), true);
    assert.equal(rolled.writtenIds.includes(lockedRow.id), true);
    assert.equal(rolled.writtenIds.includes(exportRow.id), true);
    assert.equal(rolled.writtenIds.includes(edited.id), false);
    assert.equal(rolled.skipped.find((row) => row.id === edited.id)?.reason, "rollback_mismatch");

    const restored = await restarted.sourceLeadEvent.findUniqueOrThrow({ where: { id: eligible.id } });
    const restoredState = readCanonicalDobAgeState(restored.normalizedPayloadJson);
    assert.deepEqual(restoredState, blank);
    const restoredPayload = restored.normalizedPayloadJson as {
      contact: { email: string };
      lead_details: Record<string, unknown>;
      routing: { niche_key: string; source_intake: { sourceAttributes: Record<string, string> } };
    };
    for (const key of [
      "date_of_birth",
      "date_of_birth_provenance",
      "consumer_age",
      "consumer_age_provenance",
      "consumer_age_reference_date",
      "consumer_age_reference_rule",
      "consumer_age_conflict",
    ]) {
      assert.equal(Object.hasOwn(restoredPayload.lead_details, key), false);
    }
    assert.equal(Object.hasOwn(restoredPayload.routing.source_intake.sourceAttributes, "date_of_birth"), false);
    assert.equal(restoredPayload.contact.email, EMAIL);
    assert.equal(restoredPayload.lead_details.coverage_note, "keep-me");
    assert.equal(restoredPayload.routing.niche_key, "vet");
    assert.equal(restoredPayload.routing.source_intake.sourceAttributes.branch, "Army");
    assert.equal(restored.receivedAt.toISOString(), "2026-11-02T18:00:00.000Z");
    assert.equal(restored.normalizedAt?.toISOString(), "2026-11-02T18:00:05.000Z");

    const editedAfter = await restarted.sourceLeadEvent.findUniqueOrThrow({ where: { id: edited.id } });
    const editedState = readCanonicalDobAgeState(editedAfter.normalizedPayloadJson);
    assert.equal(editedState.date_of_birth, "1955-03-13");
    assert.equal(editedState.consumer_age, "55");
    assert.equal(editedState.source_attribute_date_of_birth, "03/13/1955");
    const editedKept = editedAfter.normalizedPayloadJson as {
      contact: { email: string };
      lead_details: { coverage_note: string };
      routing: { source_intake: { sourceAttributes: { branch: string } } };
    };
    assert.equal(editedKept.contact.email, EMAIL);
    assert.equal(editedKept.lead_details.coverage_note, "keep-me");
    assert.equal(editedKept.routing.source_intake.sourceAttributes.branch, "Army");

    const rollbackAudits = await readDobCorrectionAuditsFromDb(restarted);
    const eligibleRollback = rollbackAudits.filter((row) => row.eventId === eligible.id && row.action === "rollback");
    assert.equal(eligibleRollback.length, 1);
    assert.equal(eligibleRollback[0]?.before.date_of_birth, "1955-03-13");
    assert.equal(eligibleRollback[0]?.before.source_attribute_date_of_birth, "03/13/1955");
    assert.equal(eligibleRollback[0]?.after.date_of_birth, null);
    assert.equal(eligibleRollback[0]?.after.source_attribute_date_of_birth, null);
    assert.equal(rollbackAudits.some((row) => row.eventId === edited.id && row.action === "rollback"), false);
    assert.equal(JSON.stringify(rollbackAudits).includes(EMAIL), false);

    const rolledAgain = await rollbackIncomingDobCorrections(restarted, {
      ...base,
      auditFile: "",
      confirm: INCOMING_DOB_CORRECTION_ROLLBACK_CONFIRMATION,
    });
    assert.deepEqual(rolledAgain.writtenIds, []);
    assert.equal(rolledAgain.skipped.find((row) => row.id === edited.id)?.reason, "rollback_mismatch");
    assert.equal(readCanonicalDobAgeState(
      (await restarted.sourceLeadEvent.findUniqueOrThrow({ where: { id: edited.id } })).normalizedPayloadJson
    ).consumer_age, "55");
  } finally {
    releaseHold();
    if (holding) await holding.catch(() => undefined);
    if (created.length > 0) {
      await restarted.sourceLeadEvent.deleteMany({ where: { id: { in: created } } });
    }
    await dropAuditTable(restarted);
    await db.$disconnect().catch(() => undefined);
    await holder.$disconnect();
    await restarted.$disconnect();
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
  const report = JSON.parse(dry.stdout) as {
    mode: string;
    writes: boolean;
    confirmedDateOfBirthBindingIds: string[];
  };
  assert.equal(report.mode, "dry_run");
  assert.equal(report.writes, false);
  assert.deepEqual(
    report.confirmedDateOfBirthBindingIds,
    confirmedDateOfBirthBindings().map((binding) => binding.id)
  );
  assert.equal(report.confirmedDateOfBirthBindingIds.includes("leadcapture_io_nextgen_vet_julia_dodge"), true);
  assert.equal(report.confirmedDateOfBirthBindingIds.includes("leadcapture_io_nextgen_vet_eriks_veidemanis"), true);
  assert.equal(
    report.confirmedDateOfBirthBindingIds.includes("leadcapture_io_nextgen_sehi_zach_busch"),
    false
  );
  assert.equal(CONFIRMED_CATALOG_DOB_FORMS.some((form) => form.alias === "date_copy"), true);

  const remote = run([], "postgresql://user:secret@db.example.com:25060/defaultdb");
  assert.equal(remote.status, 2);
  assert.match(`${remote.stdout}\n${remote.stderr}`, /remote_database_refused/);
  assert.equal(`${remote.stdout}${remote.stderr}`.includes("secret"), false);

  const apply = run(["--apply", "--expected-db-host", "127.0.0.1:5432", "--limit", "1"], databaseUrl);
  assert.equal(apply.status, 2);
  assert.match(`${apply.stdout}\n${apply.stderr}`, /confirmation_phrase_mismatch|confirmation_mismatch/);

  const unscoped = run([
    "--apply",
    "--expected-db-host", "127.0.0.1:5432",
    "--limit", "1",
    "--operator", "correction-test",
    "--confirm", `"${INCOMING_DOB_CORRECTION_APPLY_CONFIRMATION}"`,
  ], databaseUrl);
  assert.equal(unscoped.status, 2);
  assert.match(`${unscoped.stdout}\n${unscoped.stderr}`, /reviewed_scope_required/);
});
