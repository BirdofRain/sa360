import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { PrismaClient } from "@prisma/client";

import {
  AGED_INVENTORY_BULK_ENRICH_COMMIT_CONFIRMATION,
  type AgedBulkCliArgs,
} from "./aged-inventory-bulk.types.js";
import {
  PROPOSED_LEAD_INVENTORY_ITEM_CREATES,
  classifySourceLeadIdMatch,
  mergeNormalizedPayloadForEnrichment,
  runAgedInventoryBulkEnrichmentBackfill,
} from "./aged-inventory-bulk-backfill.service.js";
import { createIdentityConflictIndex, normalizeMasterRow } from "./aged-inventory-bulk-normalize.js";
import { sha256File } from "./aged-inventory-bulk-stream.js";

const TRUCKER_HEADER =
  "Date,LEAD TYPE,CLIENT NAME,PHONE,EMAIL,STATE/ZIP,AGE,COMPANY OR INDY?,RIG TYPE?,Beneficiary,Synced,Date Used Last,Used By:,STATUS";

const TRUCKER_ROW =
  "7/15/2025 3:45:00 PM,Some Agent - Trucker Campaign,Jane Doe,5551234567,jane.doe@example.com,TX 75001,70,Company,Sleeper,Spouse,Yes,6/1/2025,Desk,PULLED";

function sampleRaw() {
  return {
    rowNumber: 1,
    dateRaw: "7/15/2025 3:45:00 PM",
    leadTypeRaw: "Some Agent - Trucker Campaign",
    clientNameRaw: "Jane Doe",
    phoneRaw: "5551234567",
    emailRaw: "jane.doe@example.com",
    stateZipRaw: "TX 75001",
    ageRaw: "70",
    dobAgeRaw: "70",
    branchOfServiceRaw: "",
    disabilityRatingRaw: "",
    primaryConcernRaw: "",
    companyOrIndependentRaw: "Company",
    rigTypeRaw: "Sleeper",
    beneficiaryRaw: "Spouse",
    syncedRaw: "Yes",
    dateUsedLastRaw: "6/1/2025",
    statusRaw: "PULLED",
    usedByRaw: "Desk",
    campaignName: "Some Agent - Trucker Campaign",
  };
}

function sampleNormalized() {
  return normalizeMasterRow({
    raw: sampleRaw(),
    nicheKey: "trucker",
    identityIndex: createIdentityConflictIndex(),
    evaluatedAt: new Date("2026-08-18T12:00:00.000Z"),
  });
}

function existingFlatIdentity(overrides: Record<string, unknown> = {}) {
  const row = sampleNormalized();
  return {
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone_e164: row.phoneE164,
    state: row.state,
    generated_at: row.generatedAt.toISOString(),
    niche_key: row.nicheKey,
    campaign_name: row.campaignName,
    status_raw: row.statusRaw,
    used_by_present: row.usedByPresent,
    email_issue: row.emailIssue,
    ...overrides,
  };
}

type FakeEvent = {
  id: string;
  sourceLeadId: string;
  normalizedPayloadJson: Record<string, unknown>;
  rawPayloadJson: Record<string, unknown>;
  enrichmentMetadataJson: Record<string, unknown>;
};

function createBackfillFake(events: FakeEvent[]) {
  const store = new Map(events.map((e) => [e.id, { ...e }]));
  const calls = {
    sourceLeadEventCreate: 0,
    sourceLeadEventUpdate: 0,
    leadInventoryItemCreate: 0,
    leadInventoryItemUpdate: 0,
    leadAllocationCreate: 0,
    leadAllocationUpdate: 0,
  };

  const db = {
    sourceLeadEvent: {
      findMany: async ({ where }: { where: { sourceLeadId: { in: string[] } } }) => {
        const ids = new Set(where.sourceLeadId.in);
        return [...store.values()].filter((e) => ids.has(e.sourceLeadId));
      },
      create: async () => {
        calls.sourceLeadEventCreate += 1;
        throw new Error("backfill_must_not_create_source_lead_event");
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: {
          normalizedPayloadJson: Record<string, unknown>;
          rawPayloadJson: Record<string, unknown>;
          enrichmentMetadataJson: Record<string, unknown>;
        };
      }) => {
        calls.sourceLeadEventUpdate += 1;
        const current = store.get(where.id);
        if (!current) throw new Error("missing_event");
        current.normalizedPayloadJson = data.normalizedPayloadJson;
        current.rawPayloadJson = data.rawPayloadJson;
        current.enrichmentMetadataJson = data.enrichmentMetadataJson;
        return current;
      },
    },
    leadInventoryItem: {
      create: async () => {
        calls.leadInventoryItemCreate += 1;
        throw new Error("backfill_must_not_create_lead_inventory_item");
      },
      update: async () => {
        calls.leadInventoryItemUpdate += 1;
        throw new Error("backfill_must_not_update_lead_inventory_item");
      },
    },
    leadAllocation: {
      create: async () => {
        calls.leadAllocationCreate += 1;
        throw new Error("backfill_must_not_touch_allocations");
      },
      update: async () => {
        calls.leadAllocationUpdate += 1;
        throw new Error("backfill_must_not_touch_allocations");
      },
    },
  };

  return { db: db as unknown as PrismaClient, store, calls };
}

async function writeCsv(dir: string, body = `${TRUCKER_HEADER}\n${TRUCKER_ROW}\n`) {
  const filePath = path.join(dir, "master.csv");
  await writeFile(filePath, body, "utf8");
  return filePath;
}

function baseArgs(file: string, sha: string, workDir: string, mode: "enrich-preview" | "enrich-commit"): AgedBulkCliArgs {
  return {
    mode,
    file,
    sourceFormat: "trucker_master_v1",
    defaultNiche: "trucker",
    batchSize: 50,
    workDir,
    expectedFileSha256: sha,
    expectedDbHost: "127.0.0.1:5432",
    operator: "qa-operator",
    confirmation:
      mode === "enrich-commit" ? AGED_INVENTORY_BULK_ENRICH_COMMIT_CONFIRMATION : undefined,
  };
}

test("fill-if-empty enrichment preserves identity and reports conflicts", () => {
  const existing = {
    ...existingFlatIdentity(),
    lead_details: {
      beneficiary: "Child",
      niche: { disability_rating: "40%" },
    },
  };
  const incoming = {
    ...existingFlatIdentity(),
    contact: {
      first_name: "Jane",
      last_name: "Doe",
      phone_e164: "+15551234567",
      email: "jane.doe@example.com",
      state: "TX",
      zip: "75001",
    },
    lead_details: {
      consumer_age: 70,
      date_of_birth: null,
      beneficiary: "Spouse",
      niche: { company_or_independent: "Company", rig_type: "Sleeper" },
    },
  };
  const merge = mergeNormalizedPayloadForEnrichment(existing, incoming);
  assert.equal(merge.merged.firstName, existing.firstName);
  assert.equal(merge.merged.generated_at, existing.generated_at);
  assert.equal(merge.merged.phone_e164, existing.phone_e164);
  assert.ok(merge.conflictFields.includes("lead_details.beneficiary"));
  assert.equal((merge.merged.lead_details as { beneficiary: string }).beneficiary, "Child");
  assert.ok(merge.filledFields.includes("contact.zip"));
  assert.ok(merge.filledFields.includes("lead_details.consumer_age"));
  assert.ok(merge.filledFields.includes("lead_details.niche.company_or_independent"));
  const niche = (merge.merged.lead_details as { niche: Record<string, string> }).niche;
  assert.equal(niche.disability_rating, "40%");
  assert.equal(niche.company_or_independent, "Company");
});

test("classifySourceLeadIdMatch is exact / unmatched / ambiguous only", () => {
  assert.equal(classifySourceLeadIdMatch([]), "unmatched_source_lead_id");
  assert.equal(
    classifySourceLeadIdMatch([
      {
        id: "a",
        sourceLeadId: "aged-v1-trucker-x",
        normalizedPayloadJson: {},
        rawPayloadJson: {},
        enrichmentMetadataJson: {},
      },
    ]),
    "exact"
  );
  assert.equal(
    classifySourceLeadIdMatch([
      {
        id: "a",
        sourceLeadId: "aged-v1-trucker-x",
        normalizedPayloadJson: {},
        rawPayloadJson: {},
        enrichmentMetadataJson: {},
      },
      {
        id: "b",
        sourceLeadId: "aged-v1-trucker-x",
        normalizedPayloadJson: {},
        rawPayloadJson: {},
        enrichmentMetadataJson: {},
      },
    ]),
    "ambiguous_source_lead_id"
  );
});

test("exact match updates event JSON and never creates inventory", async () => {
  process.env.DATABASE_URL = "postgresql://sa360@127.0.0.1:5432/sa360_test";
  const dir = await mkdtemp(path.join(os.tmpdir(), "aged-enrich-"));
  try {
    const file = await writeCsv(dir);
    const sha = await sha256File(file);
    const row = sampleNormalized();
    const generatedAtIso = row.generatedAt.toISOString();
    const { db, store, calls } = createBackfillFake([
      {
        id: "evt-1",
        sourceLeadId: row.sourceLeadId,
        normalizedPayloadJson: existingFlatIdentity({ generated_at: generatedAtIso }),
        rawPayloadJson: { importRequestId: "aged-bulk-existing", rowNumber: 1 },
        enrichmentMetadataJson: { sourceLane: "aged_inventory_bulk_csv" },
      },
    ]);

    const preview = await runAgedInventoryBulkEnrichmentBackfill(
      baseArgs(file, sha, dir, "enrich-preview"),
      db
    );
    assert.equal(preview.report.exactExistingMatches, 1);
    assert.equal(preview.report.proposedLeadInventoryItemCreates, 0);
    assert.equal(preview.report.proposedSourceLeadEventUpdates, 1);
    assert.equal(preview.report.appliedSourceLeadEventUpdates, 0);
    assert.equal(calls.sourceLeadEventUpdate, 0);
    assert.equal(calls.leadInventoryItemCreate, 0);

    const commit = await runAgedInventoryBulkEnrichmentBackfill(
      baseArgs(file, sha, dir, "enrich-commit"),
      db
    );
    assert.equal(commit.report.proposedLeadInventoryItemCreates, PROPOSED_LEAD_INVENTORY_ITEM_CREATES);
    assert.equal(commit.report.actualLeadInventoryItemCreates, 0);
    assert.equal(commit.report.appliedSourceLeadEventUpdates, 1);
    assert.equal(calls.sourceLeadEventCreate, 0);
    assert.equal(calls.leadInventoryItemCreate, 0);
    assert.equal(calls.leadInventoryItemUpdate, 0);
    assert.equal(calls.leadAllocationCreate, 0);

    const updated = store.get("evt-1")!;
    assert.equal(updated.normalizedPayloadJson.generated_at, generatedAtIso);
    assert.equal(updated.normalizedPayloadJson.firstName, "Jane");
    assert.equal((updated.normalizedPayloadJson.contact as { zip: string }).zip, "75001");
    assert.equal((updated.normalizedPayloadJson.lead_details as { consumer_age: number }).consumer_age, 70);
    assert.equal((updated.rawPayloadJson as { importRequestId: string }).importRequestId, "aged-bulk-existing");
    assert.equal((updated.rawPayloadJson as { rowNumber: number }).rowNumber, 1);
    assert.equal(
      (updated.rawPayloadJson.master as { lead_type: string }).lead_type,
      "Some Agent - Trucker Campaign"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("zero match does not create and multiple matches do not write", async () => {
  process.env.DATABASE_URL = "postgresql://sa360@127.0.0.1:5432/sa360_test";
  const dir = await mkdtemp(path.join(os.tmpdir(), "aged-enrich-"));
  try {
    const file = await writeCsv(dir);
    const sha = await sha256File(file);
    const row = sampleNormalized();

    const unmatched = createBackfillFake([]);
    const unmatchedResult = await runAgedInventoryBulkEnrichmentBackfill(
      baseArgs(file, sha, dir, "enrich-commit"),
      unmatched.db
    );
    assert.equal(unmatchedResult.report.unmatchedRows, 1);
    assert.equal(unmatchedResult.report.appliedSourceLeadEventUpdates, 0);
    assert.equal(unmatched.calls.sourceLeadEventCreate, 0);
    assert.equal(unmatched.calls.leadInventoryItemCreate, 0);

    const ambiguous = createBackfillFake([
      {
        id: "evt-a",
        sourceLeadId: row.sourceLeadId,
        normalizedPayloadJson: existingFlatIdentity(),
        rawPayloadJson: { importRequestId: "a", rowNumber: 1 },
        enrichmentMetadataJson: {},
      },
      {
        id: "evt-b",
        sourceLeadId: row.sourceLeadId,
        normalizedPayloadJson: existingFlatIdentity(),
        rawPayloadJson: { importRequestId: "b", rowNumber: 2 },
        enrichmentMetadataJson: {},
      },
    ]);
    const ambiguousResult = await runAgedInventoryBulkEnrichmentBackfill(
      baseArgs(file, sha, dir, "enrich-commit"),
      ambiguous.db
    );
    assert.equal(ambiguousResult.report.ambiguousRows, 1);
    assert.equal(ambiguousResult.report.appliedSourceLeadEventUpdates, 0);
    assert.equal(ambiguous.calls.sourceLeadEventUpdate, 0);
    assert.equal(ambiguous.calls.leadInventoryItemCreate, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("repeat backfill is idempotent and conflicting enrichment is reported", async () => {
  process.env.DATABASE_URL = "postgresql://sa360@127.0.0.1:5432/sa360_test";
  const dir = await mkdtemp(path.join(os.tmpdir(), "aged-enrich-"));
  try {
    const file = await writeCsv(dir);
    const sha = await sha256File(file);
    const row = sampleNormalized();
    const { db, store, calls } = createBackfillFake([
      {
        id: "evt-1",
        sourceLeadId: row.sourceLeadId,
        normalizedPayloadJson: existingFlatIdentity({
          lead_details: { beneficiary: "Child", niche: {} },
        }),
        rawPayloadJson: { importRequestId: "keep-me", rowNumber: 9 },
        enrichmentMetadataJson: {},
      },
    ]);

    const first = await runAgedInventoryBulkEnrichmentBackfill(baseArgs(file, sha, dir, "enrich-commit"), db);
    assert.equal(first.report.fieldConflictRows, 1);
    assert.equal(first.report.rowsNeedingEnrichment, 1);
    assert.equal(
      (store.get("evt-1")!.normalizedPayloadJson.lead_details as { beneficiary: string }).beneficiary,
      "Child"
    );

    const second = await runAgedInventoryBulkEnrichmentBackfill(baseArgs(file, sha, dir, "enrich-commit"), db);
    assert.equal(second.report.appliedSourceLeadEventUpdates, 0);
    assert.equal(calls.leadInventoryItemCreate, 0);
    assert.equal(store.get("evt-1")!.rawPayloadJson.importRequestId, "keep-me");
    assert.equal(store.get("evt-1")!.rawPayloadJson.rowNumber, 9);
    assert.equal(PROPOSED_LEAD_INVENTORY_ITEM_CREATES, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
