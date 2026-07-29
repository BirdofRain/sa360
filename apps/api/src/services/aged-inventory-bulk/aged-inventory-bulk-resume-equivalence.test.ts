/**
 * Proves resume rebuild via PII-free rescan yields identical dispositions and
 * accepted-set fingerprints regardless of interrupt point / chunk boundary.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DEFAULT_AGE_BANDS_V1 } from "../lead-inventory/lead-inventory.constants.js";
import {
  adaptMasterRow,
  assertMasterHeaders,
} from "./aged-inventory-bulk-adapters.js";
import { RollingSetFingerprint } from "./aged-inventory-bulk-checkpoint.js";
import {
  createIdentityConflictIndex,
  isAcceptDisposition,
  normalizeMasterRow,
} from "./aged-inventory-bulk-normalize.js";
import { rescanSourceRowsForResume } from "./aged-inventory-bulk-rescan.js";
import { streamCsvFile } from "./aged-inventory-bulk-stream.js";

const HEADER =
  "Date,Lead Type,Client Name,Phone,Email,STATE/ZIP,AGE,STATUS,Used By:";

function row(
  date: string,
  name: string,
  phone: string,
  email: string,
  state: string,
  status = "",
  usedBy = ""
) {
  return `${date},Campaign Label,${name},${phone},${email},${state},40,${status},${usedBy}`;
}

async function writeFixture(dir: string): Promise<string> {
  // Includes: unique accepts, exact source dup, phone/email identity conflict,
  // PULLED retained, Used By retained, email-issue retained path.
  const lines = [
    HEADER,
    row("7/1/2025", "Alice Able", "5551000001", "alice@example.com", "TX 75001"),
    row("7/2/2025", "Bob Baker", "5551000002", "bob@example.com", "TX 75002"),
    // exact content duplicate of Alice (same identity fields + date) → exact_source_duplicate
    row("7/1/2025", "Alice Able", "5551000001", "alice@example.com", "TX 75001"),
    // identity conflict: same phone, different email
    row("7/3/2025", "Alice Conflict", "5551000001", "alice.other@example.com", "TX 75001"),
    row("7/4/2025", "Cara Cole", "5551000003", "cara@example.com", "CA 90001", "PULLED", "Agent Z"),
    row("7/5/2025", "Dan Dunn", "5551000004", "not-an-email", "FL 33101"),
    row("7/6/2025", "Eve East", "5551000005", "eve@example.com", "NY 10001"),
    row("7/7/2025", "Frank Finn", "5551000006", "frank@example.com", "OH 44101"),
    row("7/8/2025", "Gina Gable", "5551000007", "gina@example.com", "WA 98101"),
    row("7/9/2025", "Hank Hill", "5551000008", "hank@example.com", "OK 73101"),
  ];
  const filePath = path.join(dir, "fixture.csv");
  await writeFile(filePath, lines.join("\n"), "utf8");
  return filePath;
}

async function classifyFull(filePath: string, evaluatedAt: Date) {
  const identityIndex = createIdentityConflictIndex();
  const acceptedFp = new RollingSetFingerprint();
  const quarantinedFp = new RollingSetFingerprint();
  const rejectedFp = new RollingSetFingerprint();
  const byDisposition: Record<string, number> = {};
  let accepted = 0;
  let quarantined = 0;
  let rejected = 0;
  let exactDup = 0;
  let headerIndex: Map<string, number> | null = null;

  await streamCsvFile(filePath, {
    onHeader: (headers) => {
      const asserted = assertMasterHeaders(headers, "trucker_master_v1");
      assert.equal(asserted.ok, true);
      if (asserted.ok) headerIndex = asserted.index;
    },
    onRow: async (rowNumber, cols) => {
      assert.ok(headerIndex);
      const normalized = normalizeMasterRow({
        raw: adaptMasterRow({
          rowNumber,
          cols,
          index: headerIndex,
          sourceFormat: "trucker_master_v1",
        }),
        nicheKey: "trucker",
        identityIndex,
        evaluatedAt,
      });
      byDisposition[normalized.disposition] =
        (byDisposition[normalized.disposition] ?? 0) + 1;
      if (isAcceptDisposition(normalized.disposition)) {
        accepted += 1;
        acceptedFp.update(normalized.sourceLeadId);
      } else if (normalized.disposition === "quarantine_identity_conflict") {
        quarantined += 1;
        quarantinedFp.update(normalized.sourceLeadId);
      } else if (
        normalized.disposition === "exact_source_duplicate" ||
        normalized.disposition === "identity_duplicate_same_date" ||
        normalized.disposition === "already_inventory"
      ) {
        exactDup += 1;
      } else {
        rejected += 1;
        rejectedFp.update(normalized.sourceLeadId);
      }
    },
  });

  return {
    accepted,
    quarantined,
    rejected,
    exactDup,
    byDisposition,
    acceptedSetRollingSha256: acceptedFp.digest(),
    quarantinedSetRollingSha256: quarantinedFp.digest(),
    rejectedSetRollingSha256: rejectedFp.digest(),
  };
}

async function classifyWithResumeSimulation(
  filePath: string,
  evaluatedAt: Date,
  interruptAfterRow: number
) {
  const rescan = await rescanSourceRowsForResume({
    filePath,
    sourceFormat: "trucker_master_v1",
    nicheKey: "trucker",
    endExclusive: interruptAfterRow + 1,
    evaluatedAt,
    ageBands: DEFAULT_AGE_BANDS_V1,
  });

  const identityIndex = rescan.identityIndex;
  const acceptedFp = rescan.acceptedFp;
  const quarantinedFp = rescan.quarantinedFp;
  const rejectedFp = rescan.rejectedFp;
  const byDisposition = { ...rescan.counts.byDisposition };
  let accepted = rescan.counts.acceptedRows;
  let quarantined = rescan.counts.quarantinedRows;
  let rejected = rescan.counts.rejectedRows;
  let exactDup = rescan.counts.exactDuplicateRows;
  let headerIndex: Map<string, number> | null = null;

  await streamCsvFile(filePath, {
    startRowNumber: interruptAfterRow + 1,
    onHeader: (headers) => {
      const asserted = assertMasterHeaders(headers, "trucker_master_v1");
      assert.equal(asserted.ok, true);
      if (asserted.ok) headerIndex = asserted.index;
    },
    onRow: async (rowNumber, cols) => {
      assert.ok(headerIndex);
      const normalized = normalizeMasterRow({
        raw: adaptMasterRow({
          rowNumber,
          cols,
          index: headerIndex,
          sourceFormat: "trucker_master_v1",
        }),
        nicheKey: "trucker",
        identityIndex,
        evaluatedAt,
      });
      byDisposition[normalized.disposition] =
        (byDisposition[normalized.disposition] ?? 0) + 1;
      if (isAcceptDisposition(normalized.disposition)) {
        accepted += 1;
        acceptedFp.update(normalized.sourceLeadId);
      } else if (normalized.disposition === "quarantine_identity_conflict") {
        quarantined += 1;
        quarantinedFp.update(normalized.sourceLeadId);
      } else if (
        normalized.disposition === "exact_source_duplicate" ||
        normalized.disposition === "identity_duplicate_same_date" ||
        normalized.disposition === "already_inventory"
      ) {
        exactDup += 1;
      } else {
        rejected += 1;
        rejectedFp.update(normalized.sourceLeadId);
      }
    },
  });

  return {
    accepted,
    quarantined,
    rejected,
    exactDup,
    byDisposition,
    acceptedSetRollingSha256: acceptedFp.digest(),
    quarantinedSetRollingSha256: quarantinedFp.digest(),
    rejectedSetRollingSha256: rejectedFp.digest(),
  };
}

test("resume rescan at multiple interrupt points matches uninterrupted classification", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aged-bulk-eq-"));
  try {
    const filePath = await writeFixture(dir);
    const evaluatedAt = new Date("2026-07-29T12:00:00.000Z");
    const baseline = await classifyFull(filePath, evaluatedAt);

    assert.ok(baseline.accepted >= 6);
    assert.ok(baseline.quarantined >= 1);
    assert.ok(baseline.exactDup >= 1);

    for (const interruptAfter of [1, 2, 4, 5, 7, 9]) {
      const resumed = await classifyWithResumeSimulation(
        filePath,
        evaluatedAt,
        interruptAfter
      );
      assert.equal(
        resumed.acceptedSetRollingSha256,
        baseline.acceptedSetRollingSha256,
        `accepted fingerprint mismatch at interrupt=${interruptAfter}`
      );
      assert.equal(
        resumed.quarantinedSetRollingSha256,
        baseline.quarantinedSetRollingSha256,
        `quarantine fingerprint mismatch at interrupt=${interruptAfter}`
      );
      assert.equal(
        resumed.rejectedSetRollingSha256,
        baseline.rejectedSetRollingSha256,
        `rejected fingerprint mismatch at interrupt=${interruptAfter}`
      );
      assert.equal(resumed.accepted, baseline.accepted);
      assert.equal(resumed.quarantined, baseline.quarantined);
      assert.equal(resumed.rejected, baseline.rejected);
      assert.equal(resumed.exactDup, baseline.exactDup);
      assert.deepEqual(resumed.byDisposition, baseline.byDisposition);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("without rescan rebuild, mid-file continue misclassifies identity conflicts", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aged-bulk-bug-"));
  try {
    const filePath = await writeFixture(dir);
    const evaluatedAt = new Date("2026-07-29T12:00:00.000Z");
    const baseline = await classifyFull(filePath, evaluatedAt);

    // Broken resume: empty identity index from row 4 onward (historical bug)
    const brokenIndex = createIdentityConflictIndex();
    let brokenAccepted = 0;
    let headerIndex: Map<string, number> | null = null;
    await streamCsvFile(filePath, {
      startRowNumber: 4,
      onHeader: (headers) => {
        const asserted = assertMasterHeaders(headers, "trucker_master_v1");
        if (asserted.ok) headerIndex = asserted.index;
      },
      onRow: async (rowNumber, cols) => {
        assert.ok(headerIndex);
        const normalized = normalizeMasterRow({
          raw: adaptMasterRow({
            rowNumber,
            cols,
            index: headerIndex,
            sourceFormat: "trucker_master_v1",
          }),
          nicheKey: "trucker",
          identityIndex: brokenIndex,
          evaluatedAt,
        });
        if (isAcceptDisposition(normalized.disposition)) brokenAccepted += 1;
      },
    });

    // Rows 1-3 had 2 accepts; broken path will over-accept the conflict row.
    assert.ok(
      brokenAccepted + 2 > baseline.accepted,
      "expected broken resume to over-accept relative to baseline"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
