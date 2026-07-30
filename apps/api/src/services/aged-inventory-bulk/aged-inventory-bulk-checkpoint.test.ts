import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AGED_BULK_CHECKPOINT_VERSION,
  AGED_BULK_NORMALIZER_VERSION,
  RollingSetFingerprint,
  assertCheckpointUsableForResume,
  assertDiskAndDbCheckpointsAgree,
  buildCheckpointPayload,
  emptyCheckpointCounts,
  loadAgedBulkCheckpoint,
  writeAgedBulkCheckpoint,
} from "./aged-inventory-bulk-checkpoint.js";

function sampleCheckpoint(overrides: Record<string, unknown> = {}) {
  return buildCheckpointPayload({
    fileSha256: "a".repeat(64),
    sourceFormat: "trucker_master_v1",
    defaultNicheKey: "trucker",
    lotKey: "lot_test",
    importRequestId: "req_test",
    evaluatedAtIso: "2026-07-29T12:00:00.000Z",
    nextRowNumber: 501,
    batchesCompleted: 2,
    acceptedSetRollingSha256: "b".repeat(64),
    quarantinedSetRollingSha256: "c".repeat(64),
    rejectedSetRollingSha256: "d".repeat(64),
    counts: emptyCheckpointCounts(),
    ...overrides,
  });
}

test("checkpoint version constants are stable", () => {
  assert.equal(AGED_BULK_CHECKPOINT_VERSION, "aged-bulk-checkpoint-v2");
  assert.equal(AGED_BULK_NORMALIZER_VERSION, "aged-bulk-normalize-v1");
});

test("rolling fingerprint is order-sensitive and PII-free digest", () => {
  const a = new RollingSetFingerprint();
  a.update("id-1");
  a.update("id-2");
  const b = new RollingSetFingerprint();
  b.update("id-2");
  b.update("id-1");
  assert.notEqual(a.digest(), b.digest());
  assert.match(a.digest(), /^[a-f0-9]{64}$/);
});

test("assertCheckpointUsableForResume fails closed when missing", () => {
  assert.throws(
    () =>
      assertCheckpointUsableForResume({
        checkpoint: null,
        fileSha256: "a".repeat(64),
        sourceFormat: "trucker_master_v1",
        defaultNicheKey: "trucker",
        lotKey: "lot_test",
        importRequestId: "req_test",
        dbNextRowNumber: 501,
      }),
    /checkpoint_missing/
  );
});

test("assertCheckpointUsableForResume fails closed on db next-row mismatch", () => {
  assert.throws(
    () =>
      assertCheckpointUsableForResume({
        checkpoint: sampleCheckpoint(),
        fileSha256: "a".repeat(64),
        sourceFormat: "trucker_master_v1",
        defaultNicheKey: "trucker",
        lotKey: "lot_test",
        importRequestId: "req_test",
        dbNextRowNumber: 999,
      }),
    /checkpoint_db_next_row_mismatch/
  );
});

test("assertCheckpointUsableForResume fails closed on version mismatch", () => {
  const bad = {
    ...sampleCheckpoint(),
    version: "aged-bulk-checkpoint-v1",
  } as never;
  assert.throws(
    () =>
      assertCheckpointUsableForResume({
        checkpoint: bad,
        fileSha256: "a".repeat(64),
        sourceFormat: "trucker_master_v1",
        defaultNicheKey: "trucker",
        lotKey: "lot_test",
        importRequestId: "req_test",
        dbNextRowNumber: 501,
      }),
    /checkpoint_version_mismatch/
  );
});

test("assertDiskAndDbCheckpointsAgree fails closed on fingerprint divergence", () => {
  const disk = sampleCheckpoint();
  const db = sampleCheckpoint({
    acceptedSetRollingSha256: "e".repeat(64),
  });
  assert.throws(
    () => assertDiskAndDbCheckpointsAgree(disk, db),
    /checkpoint_disk_db_mismatch:field=acceptedSetRollingSha256/
  );
  assert.doesNotThrow(() => assertDiskAndDbCheckpointsAgree(disk, sampleCheckpoint()));
  assert.doesNotThrow(() => assertDiskAndDbCheckpointsAgree(disk, null));
});

test("write/load round-trip preserves versioned checkpoint without contact fields", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aged-bulk-cp-"));
  try {
    const cp = sampleCheckpoint({
      counts: {
        ...emptyCheckpointCounts(),
        acceptedRows: 12,
        quarantinedRows: 3,
      },
    });
    await writeAgedBulkCheckpoint(dir, cp);
    const loaded = await loadAgedBulkCheckpoint(dir, cp.fileSha256);
    assert.ok(loaded);
    assert.equal(loaded.version, AGED_BULK_CHECKPOINT_VERSION);
    assert.equal(loaded.nextRowNumber, 501);
    assert.equal(loaded.counts.acceptedRows, 12);
    const serialized = JSON.stringify(loaded);
    assert.equal(serialized.includes("@"), false);
    assert.equal(/\+1\d{10}/.test(serialized), false);
    assert.equal(/@[a-z0-9.-]+\.[a-z]{2,}/i.test(serialized), false);
    assert.equal(serialized.includes("alice"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
