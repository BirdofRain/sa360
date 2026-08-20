import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { PrismaClient } from "@prisma/client";

import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import { extractBuyerCsvV3Fields } from "../ppl-fulfillment/buyer-csv-export.service.js";
import {
  buildAgedBulkNormalizedPayload,
  createIdentityConflictIndex,
  normalizeMasterRow,
} from "./aged-inventory-bulk-normalize.js";
import {
  assignRecoveryGrouping,
  claimRecoverySourceLeadId,
  classifyRecoveryRowDecision,
  classifyStrongConsumerIdentity,
  generatedDateIso,
  recoveryFingerprints,
  type RecoveryIdentityHit,
} from "./aged-inventory-bulk-recovery-classify.js";
import { runAgedInventoryBulkRecovery } from "./aged-inventory-bulk-recovery.service.js";
import { sha256File } from "./aged-inventory-bulk-stream.js";
import {
  AGED_INVENTORY_BULK_RECOVERY_COMMIT_CONFIRMATION,
  type AgedBulkCliArgs,
} from "./aged-inventory-bulk.types.js";

const VET_HEADER =
  "Date,Lead Type,Client Name,Phone,Email,State / Zip,DOB/ AGE,Branch of Service,Disability Rating,Primary Concern,Beneficiary,Date Used Last,Used By:,STATUS";

function vetCsvRow(input: {
  date: string;
  name: string;
  phone: string;
  email: string;
  stateZip: string;
  age?: string;
  branch?: string;
  rating?: string;
  concern?: string;
  beneficiary?: string;
}): string {
  return [
    input.date,
    "Vet FEX Agent Label",
    input.name,
    input.phone,
    input.email,
    input.stateZip,
    input.age ?? "62",
    input.branch ?? "Army",
    input.rating ?? "40%",
    input.concern ?? "Income",
    input.beneficiary ?? "Spouse",
    "6/1/2025",
    "Desk",
    "PULLED",
  ].join(",");
}

function sampleRaw(overrides: Record<string, string> = {}) {
  return {
    rowNumber: 1,
    dateRaw: "7/15/2025 3:45:00 PM",
    leadTypeRaw: "Vet FEX Agent Label",
    clientNameRaw: "Ada Lovelace",
    phoneRaw: "5551234567",
    emailRaw: "ada@example.com",
    stateZipRaw: "NC 27513",
    ageRaw: "62",
    dobAgeRaw: "62",
    branchOfServiceRaw: "Army",
    disabilityRatingRaw: "40%",
    primaryConcernRaw: "Income",
    companyOrIndependentRaw: "",
    rigTypeRaw: "",
    beneficiaryRaw: "Spouse",
    syncedRaw: "",
    dateUsedLastRaw: "6/1/2025",
    statusRaw: "PULLED",
    usedByRaw: "Desk",
    campaignName: "Vet FEX Agent Label",
    ...overrides,
  };
}

function sampleNormalized(overrides: Record<string, string> = {}) {
  return normalizeMasterRow({
    raw: sampleRaw(overrides),
    nicheKey: "vet",
    identityIndex: createIdentityConflictIndex(),
    evaluatedAt: new Date("2026-08-18T12:00:00.000Z"),
  });
}

function hit(partial: Partial<RecoveryIdentityHit> & Pick<RecoveryIdentityHit, "inventoryItemId">): RecoveryIdentityHit {
  return {
    sourceLeadEventId: `evt-${partial.inventoryItemId}`,
    sourceProvider: "manual_import",
    sourceSystem: "csv_import",
    sourceLane: "aged_inventory_bulk_csv",
    phoneFingerprint: null,
    emailFingerprint: null,
    ...partial,
  };
}

type FakeEvent = {
  id: string;
  sourceLeadId: string;
  sourceProvider: string;
  sourceSystem: string;
  sourceRouteKey?: string;
  normalizedPayloadJson: Record<string, unknown>;
  rawPayloadJson: Record<string, unknown>;
  enrichmentMetadataJson: Record<string, unknown>;
};

type FakeItem = {
  id: string;
  sourceLeadEventId: string;
  inventoryLotId: string;
  generatedAt: Date;
  normalizedState: string;
  nicheKey: string;
  sourceProvider: string;
  sourceLane: string;
  status: string;
  phoneFingerprint: string | null;
  emailFingerprint: string | null;
  metadataJson: Record<string, unknown>;
  fulfillmentCount: number;
};

type FakeLot = {
  id: string;
  lotKey: string;
  metadataJson: Record<string, unknown>;
};

function createRecoveryFake(seed?: { events?: FakeEvent[]; items?: FakeItem[]; lots?: FakeLot[] }) {
  const events = new Map((seed?.events ?? []).map((e) => [e.id, { ...e }]));
  const items = new Map((seed?.items ?? []).map((i) => [i.id, { ...i }]));
  const lots = new Map((seed?.lots ?? []).map((l) => [l.lotKey, { ...l }]));
  let seq = 1;
  const calls = {
    sourceLeadEventCreate: 0,
    sourceLeadEventUpdate: 0,
    leadInventoryItemCreate: 0,
    leadInventoryItemUpdate: 0,
    leadAllocationCreate: 0,
    buyerDeliveredIdentityCreate: 0,
    exportPackageCreate: 0,
    advisoryLocks: 0,
  };
  let failNextItemCreate = false;
  const transactionHooks: Array<() => void> = [];

  function snapshot() {
    return {
      events: new Map([...events.entries()].map(([k, v]) => [k, { ...v }])),
      items: new Map([...items.entries()].map(([k, v]) => [k, { ...v }])),
      lots: new Map([...lots.entries()].map(([k, v]) => [k, { ...v }])),
    };
  }

  function restore(prior: ReturnType<typeof snapshot>) {
    events.clear();
    items.clear();
    lots.clear();
    for (const [k, v] of prior.events) events.set(k, v);
    for (const [k, v] of prior.items) items.set(k, v);
    for (const [k, v] of prior.lots) lots.set(k, v);
  }

  function buildDb(): PrismaClient {
    return {
      sourceLeadEvent: {
        findMany: async ({ where }: { where: { sourceLeadId?: { in: string[] } } }) => {
          const ids = new Set(where.sourceLeadId?.in ?? []);
          return [...events.values()].filter((e) => ids.has(e.sourceLeadId));
        },
        findFirst: async ({ where }: { where: { sourceLeadId?: string } }) => {
          return [...events.values()].find((e) => e.sourceLeadId === where.sourceLeadId) ?? null;
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          calls.sourceLeadEventCreate += 1;
          const created: FakeEvent = {
            id: `evt-new-${seq++}`,
            sourceLeadId: String(data.sourceLeadId),
            sourceProvider: String(data.sourceProvider),
            sourceSystem: String(data.sourceSystem),
            sourceRouteKey: data.sourceRouteKey ? String(data.sourceRouteKey) : undefined,
            normalizedPayloadJson: (data.normalizedPayloadJson as Record<string, unknown>) ?? {},
            rawPayloadJson: (data.rawPayloadJson as Record<string, unknown>) ?? {},
            enrichmentMetadataJson: (data.enrichmentMetadataJson as Record<string, unknown>) ?? {},
          };
          events.set(created.id, created);
          return created;
        },
        update: async () => {
          calls.sourceLeadEventUpdate += 1;
          throw new Error("recovery_must_not_update_source_lead_event");
        },
      },
      leadInventoryItem: {
        findMany: async ({
          where,
        }: {
          where: { OR?: Array<{ phoneFingerprint?: { in: string[] }; emailFingerprint?: { in: string[] } }> };
        }) => {
          const phoneWanted = new Set<string>();
          const emailWanted = new Set<string>();
          for (const clause of where.OR ?? []) {
            for (const fp of clause.phoneFingerprint?.in ?? []) phoneWanted.add(fp);
            for (const fp of clause.emailFingerprint?.in ?? []) emailWanted.add(fp);
          }
          return [...items.values()]
            .filter((item) => {
              if (item.phoneFingerprint && phoneWanted.has(item.phoneFingerprint)) return true;
              if (item.emailFingerprint && emailWanted.has(item.emailFingerprint)) return true;
              return false;
            })
            .map((item) => {
              const event = events.get(item.sourceLeadEventId);
              return {
                ...item,
                sourceLeadEvent: event ? { sourceSystem: event.sourceSystem } : { sourceSystem: "csv_import" },
              };
            });
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          calls.leadInventoryItemCreate += 1;
          if (failNextItemCreate) {
            failNextItemCreate = false;
            throw new Error("forced_item_create_failure");
          }
          const created: FakeItem = {
            id: `item-new-${seq++}`,
            sourceLeadEventId: String(data.sourceLeadEventId),
            inventoryLotId: String(data.inventoryLotId),
            generatedAt: data.generatedAt as Date,
            normalizedState: String(data.normalizedState),
            nicheKey: String(data.nicheKey),
            sourceProvider: String(data.sourceProvider),
            sourceLane: String(data.sourceLane),
            status: String(data.status),
            phoneFingerprint: (data.phoneFingerprint as string | null) ?? null,
            emailFingerprint: (data.emailFingerprint as string | null) ?? null,
            metadataJson: (data.metadataJson as Record<string, unknown>) ?? {},
            fulfillmentCount: 0,
          };
          items.set(created.id, created);
          return created;
        },
        update: async () => {
          calls.leadInventoryItemUpdate += 1;
          throw new Error("recovery_must_not_update_lead_inventory_item");
        },
      },
      inventoryLot: {
        findUnique: async ({ where }: { where: { lotKey: string } }) => lots.get(where.lotKey) ?? null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const created: FakeLot = {
            id: `lot-new-${seq++}`,
            lotKey: String(data.lotKey),
            metadataJson: (data.metadataJson as Record<string, unknown>) ?? {},
          };
          lots.set(created.lotKey, created);
          return created;
        },
      },
      leadAllocation: {
        create: async () => {
          calls.leadAllocationCreate += 1;
          throw new Error("recovery_must_not_create_allocation");
        },
      },
      buyerDeliveredIdentity: {
        create: async () => {
          calls.buyerDeliveredIdentityCreate += 1;
          throw new Error("recovery_must_not_create_buyer_identity");
        },
      },
      leadDeliveryExportPackage: {
        create: async () => {
          calls.exportPackageCreate += 1;
          throw new Error("recovery_must_not_create_export_package");
        },
      },
      $executeRaw: async () => {
        calls.advisoryLocks += 1;
        return 1;
      },
      $transaction: async (fn: (tx: PrismaClient) => Promise<unknown>) => {
        const prior = snapshot();
        try {
          transactionHooks.shift()?.();
          return await fn(buildDb());
        } catch (err) {
          restore(prior);
          throw err;
        }
      },
    } as unknown as PrismaClient;
  }

  return {
    db: buildDb(),
    events,
    items,
    lots,
    calls,
    addEvent(event: FakeEvent) {
      events.set(event.id, event);
    },
    addItem(item: FakeItem) {
      items.set(item.id, item);
    },
    failNextItemCreateOnce() {
      failNextItemCreate = true;
    },
    onNextTransactions(hooks: Array<() => void>) {
      transactionHooks.push(...hooks);
    },
  };
}

async function writeCsv(dir: string, rows: string[]) {
  const filePath = path.join(dir, "master.csv");
  await writeFile(filePath, `${VET_HEADER}\n${rows.join("\n")}\n`, "utf8");
  return filePath;
}

function baseArgs(
  file: string,
  sha: string,
  workDir: string,
  mode: "recovery-preview" | "recovery-commit"
): AgedBulkCliArgs {
  return {
    mode,
    file,
    sourceFormat: "vet_master_v1",
    defaultNiche: "vet",
    batchSize: 50,
    workDir,
    expectedFileSha256: sha,
    expectedDbHost: "127.0.0.1:5432",
    operator: "qa-operator",
    confirmation:
      mode === "recovery-commit" ? AGED_INVENTORY_BULK_RECOVERY_COMMIT_CONFIRMATION : undefined,
  };
}

test("exact source ID existing is skipped and never created", async () => {
  process.env.DATABASE_URL = "postgresql://sa360@127.0.0.1:5432/sa360_test";
  const dir = await mkdtemp(path.join(os.tmpdir(), "aged-recovery-"));
  try {
    const row = sampleNormalized();
    const file = await writeCsv(dir, [
      vetCsvRow({
        date: "7/15/2025 3:45:00 PM",
        name: "Ada Lovelace",
        phone: "5551234567",
        email: "ada@example.com",
        stateZip: "NC 27513",
      }),
    ]);
    const sha = await sha256File(file);
    const fake = createRecoveryFake({
      events: [
        {
          id: "evt-existing",
          sourceLeadId: row.sourceLeadId,
          sourceProvider: "manual_import",
          sourceSystem: "csv_import",
          normalizedPayloadJson: {},
          rawPayloadJson: {},
          enrichmentMetadataJson: {},
        },
      ],
    });
    const preview = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-preview"), fake.db);
    assert.equal(preview.report.existingExact, 1);
    assert.equal(preview.report.recoveryCandidates, 0);
    assert.equal(preview.report.proposedSourceLeadEventCreates, 0);
    assert.equal(preview.report.appliedSourceLeadEventCreates, 0);
    assert.equal(fake.calls.sourceLeadEventCreate, 0);

    const commit = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-commit"), fake.db);
    assert.equal(commit.report.appliedSourceLeadEventCreates, 0);
    assert.equal(commit.report.appliedLeadInventoryItemCreates, 0);
    assert.equal(fake.calls.sourceLeadEventCreate, 0);
    assert.equal(fake.calls.leadInventoryItemCreate, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("same consumer different source ID is skipped", async () => {
  process.env.DATABASE_URL = "postgresql://sa360@127.0.0.1:5432/sa360_test";
  const dir = await mkdtemp(path.join(os.tmpdir(), "aged-recovery-"));
  try {
    const incoming = sampleNormalized({ dateRaw: "8/01/2025 3:45:00 PM" });
    const fps = recoveryFingerprints(incoming);
    const file = await writeCsv(dir, [
      vetCsvRow({
        date: "8/01/2025 3:45:00 PM",
        name: "Ada Lovelace",
        phone: "5551234567",
        email: "ada@example.com",
        stateZip: "NC 27513",
      }),
    ]);
    const sha = await sha256File(file);
    const fake = createRecoveryFake({
      events: [
        {
          id: "evt-other",
          sourceLeadId: "aged-v1-vet-differentid00000001",
          sourceProvider: "manual_import",
          sourceSystem: "csv_import",
          normalizedPayloadJson: {},
          rawPayloadJson: {},
          enrichmentMetadataJson: {},
        },
      ],
      items: [
        {
          id: "item-other",
          sourceLeadEventId: "evt-other",
          inventoryLotId: "lot-july",
          generatedAt: new Date("2025-07-15T12:00:00.000Z"),
          normalizedState: "NC",
          nicheKey: "vet",
          sourceProvider: "manual_import",
          sourceLane: "aged_inventory_bulk_csv",
          status: "available",
          phoneFingerprint: fps.phoneFingerprint,
          emailFingerprint: fps.emailFingerprint,
          metadataJson: {},
          fulfillmentCount: 0,
        },
      ],
    });
    const preview = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-preview"), fake.db);
    assert.equal(preview.report.existingConsumer, 1);
    assert.equal(preview.report.recoveryCandidates, 0);
    assert.equal(preview.report.existingConsumerBySource["manual_import/csv_import/aged_inventory_bulk_csv"], 1);
    const commit = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-commit"), fake.db);
    assert.equal(commit.report.appliedLeadInventoryItemCreates, 0);
    assert.equal(fake.items.size, 1);
    assert.equal(fake.items.get("item-other")?.generatedAt.toISOString(), "2025-07-15T12:00:00.000Z");
    assert.equal(fake.calls.sourceLeadEventUpdate, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("same phone fingerprint is a strong skip; same email fingerprint is a strong skip", () => {
  const phone = fingerprintIdentityValue("phone", "+15551234567");
  const email = fingerprintIdentityValue("email", "ada@example.com");
  const phoneOnly = classifyStrongConsumerIdentity({
    phoneHits: [hit({ inventoryItemId: "p1", phoneFingerprint: phone })],
    emailHits: [],
  });
  assert.equal(phoneOnly.kind, "existing_consumer");

  const emailOnly = classifyStrongConsumerIdentity({
    phoneHits: [],
    emailHits: [hit({ inventoryItemId: "e1", emailFingerprint: email })],
  });
  assert.equal(emailOnly.kind, "existing_consumer");
});

test("phone and email pointing at different consumers is ambiguous and does not create", async () => {
  process.env.DATABASE_URL = "postgresql://sa360@127.0.0.1:5432/sa360_test";
  const dir = await mkdtemp(path.join(os.tmpdir(), "aged-recovery-"));
  try {
    const incoming = sampleNormalized();
    const fps = recoveryFingerprints(incoming);
    const file = await writeCsv(dir, [
      vetCsvRow({
        date: "7/15/2025 3:45:00 PM",
        name: "Ada Lovelace",
        phone: "5551234567",
        email: "ada@example.com",
        stateZip: "NC 27513",
      }),
    ]);
    const sha = await sha256File(file);
    const verdict = classifyStrongConsumerIdentity({
      phoneHits: [hit({ inventoryItemId: "phone-person", phoneFingerprint: fps.phoneFingerprint })],
      emailHits: [hit({ inventoryItemId: "email-person", emailFingerprint: fps.emailFingerprint })],
    });
    assert.equal(verdict.kind, "ambiguous");
    if (verdict.kind === "ambiguous") assert.equal(verdict.reason, "phone_email_diverge");

    const fake = createRecoveryFake({
      events: [
        {
          id: "evt-phone",
          sourceLeadId: "aged-v1-vet-phoneperson0000001",
          sourceProvider: "manual_import",
          sourceSystem: "csv_import",
          normalizedPayloadJson: {},
          rawPayloadJson: {},
          enrichmentMetadataJson: {},
        },
        {
          id: "evt-email",
          sourceLeadId: "aged-v1-vet-emailperson0000001",
          sourceProvider: "leadcapture",
          sourceSystem: "webhook",
          normalizedPayloadJson: {},
          rawPayloadJson: {},
          enrichmentMetadataJson: {},
        },
      ],
      items: [
        {
          id: "phone-person",
          sourceLeadEventId: "evt-phone",
          inventoryLotId: "lot-a",
          generatedAt: new Date("2025-01-01T12:00:00.000Z"),
          normalizedState: "NC",
          nicheKey: "vet",
          sourceProvider: "manual_import",
          sourceLane: "aged_inventory_bulk_csv",
          status: "available",
          phoneFingerprint: fps.phoneFingerprint,
          emailFingerprint: fingerprintIdentityValue("email", "other@example.com"),
          metadataJson: {},
          fulfillmentCount: 0,
        },
        {
          id: "email-person",
          sourceLeadEventId: "evt-email",
          inventoryLotId: "lot-b",
          generatedAt: new Date("2025-02-01T12:00:00.000Z"),
          normalizedState: "TX",
          nicheKey: "vet",
          sourceProvider: "leadcapture",
          sourceLane: "campaign_webhook",
          status: "available",
          phoneFingerprint: fingerprintIdentityValue("phone", "+15559999999"),
          emailFingerprint: fps.emailFingerprint,
          metadataJson: {},
          fulfillmentCount: 0,
        },
      ],
    });
    const preview = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-preview"), fake.db);
    assert.equal(preview.report.ambiguousConsumer, 1);
    assert.equal(preview.report.recoveryCandidates, 0);
    assert.equal(preview.report.ambiguousReasons.phone_email_diverge, 1);
    const commit = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-commit"), fake.db);
    assert.equal(commit.report.appliedSourceLeadEventCreates, 0);
    assert.equal(fake.calls.sourceLeadEventCreate, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("first invalid state then later same sourceLeadId is file duplicate, not a candidate", async () => {
  process.env.DATABASE_URL = "postgresql://sa360@127.0.0.1:5432/sa360_test";
  const dir = await mkdtemp(path.join(os.tmpdir(), "aged-recovery-"));
  try {
    const file = await writeCsv(dir, [
      vetCsvRow({
        date: "7/15/2025 3:45:00 PM",
        name: "Ada Lovelace",
        phone: "5551234567",
        email: "ada@example.com",
        stateZip: "ZZ 00000",
      }),
      vetCsvRow({
        date: "7/15/2025 3:45:00 PM",
        name: "Ada Lovelace",
        phone: "5551234567",
        email: "ada@example.com",
        stateZip: "NC 27513",
      }),
    ]);
    const sha = await sha256File(file);
    const fake = createRecoveryFake();
    const preview = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-preview"), fake.db);
    assert.equal(preview.report.invalidRows, 1);
    assert.equal(preview.report.invalidDisposition.reject_invalid_state, 1);
    assert.equal(preview.report.fileDuplicates, 1);
    assert.equal(preview.report.recoveryCandidates, 0);
    const commit = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-commit"), fake.db);
    assert.equal(commit.report.appliedSourceLeadEventCreates, 0);
    assert.equal(commit.report.appliedLeadInventoryItemCreates, 0);
    assert.equal(fake.calls.sourceLeadEventCreate, 0);
    assert.equal(fake.calls.leadInventoryItemCreate, 0);
    assert.equal(fake.events.size, 0);
    assert.equal(fake.items.size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("first quarantine_identity_conflict then later same sourceLeadId is file duplicate", async () => {
  process.env.DATABASE_URL = "postgresql://sa360@127.0.0.1:5432/sa360_test";
  const dir = await mkdtemp(path.join(os.tmpdir(), "aged-recovery-"));
  try {
    const seed = sampleNormalized({
      phoneRaw: "5550000001",
      emailRaw: "seed@example.com",
      clientNameRaw: "Seed Person",
    });
    const file = await writeCsv(dir, [
      vetCsvRow({
        date: "7/15/2025 3:45:00 PM",
        name: "Seed Person",
        phone: "5550000001",
        email: "seed@example.com",
        stateZip: "NC 27513",
      }),
      vetCsvRow({
        date: "7/16/2025 3:45:00 PM",
        name: "Ada Lovelace",
        phone: "5550000001",
        email: "ada@example.com",
        stateZip: "NC 27513",
      }),
      vetCsvRow({
        date: "7/16/2025 3:45:00 PM",
        name: "Ada Lovelace",
        phone: "5550000001",
        email: "ada@example.com",
        stateZip: "NC 27513",
      }),
    ]);
    const sha = await sha256File(file);
    const fake = createRecoveryFake({
      events: [
        {
          id: "evt-seed",
          sourceLeadId: seed.sourceLeadId,
          sourceProvider: "manual_import",
          sourceSystem: "csv_import",
          normalizedPayloadJson: {},
          rawPayloadJson: {},
          enrichmentMetadataJson: {},
        },
      ],
    });
    const preview = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-preview"), fake.db);
    assert.equal(preview.report.existingExact, 1);
    assert.equal(preview.report.invalidDisposition.quarantine_identity_conflict, 1);
    assert.equal(preview.report.fileDuplicates, 1);
    assert.equal(preview.report.recoveryCandidates, 0);
    const commit = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-commit"), fake.db);
    assert.equal(commit.report.appliedSourceLeadEventCreates, 0);
    assert.equal(fake.calls.sourceLeadEventCreate, 0);
    assert.equal(fake.calls.leadInventoryItemCreate, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("first reject_invalid_name with derivable sourceLeadId then later same ID is file duplicate", () => {
  const later = sampleNormalized();
  const first = {
    ...later,
    disposition: "reject_invalid_name" as const,
    blockerCodes: ["invalid_name"],
  };
  assert.equal(first.sourceLeadId, later.sourceLeadId);
  const seen = new Set<string>();
  assert.equal(claimRecoverySourceLeadId(seen, first), "FIRST_OCCURRENCE");
  assert.equal(claimRecoverySourceLeadId(seen, later), "FILE_DUPLICATE");
  assert.equal(
    classifyRecoveryRowDecision({
      row: first,
      exactSourceExists: false,
      consumer: { kind: "none" },
    }),
    "INVALID"
  );
  assert.equal(
    classifyRecoveryRowDecision({
      row: later,
      exactSourceExists: false,
      consumer: { kind: "none" },
      sameFileSourceAlreadySeen: true,
    }),
    "FILE_DUPLICATE"
  );
});

test("first valid candidate then later same sourceLeadId is candidate plus file duplicate", async () => {
  process.env.DATABASE_URL = "postgresql://sa360@127.0.0.1:5432/sa360_test";
  const dir = await mkdtemp(path.join(os.tmpdir(), "aged-recovery-"));
  try {
    const file = await writeCsv(dir, [
      vetCsvRow({
        date: "7/15/2025 3:45:00 PM",
        name: "Ada Lovelace",
        phone: "5551234567",
        email: "ada@example.com",
        stateZip: "NC 27513",
      }),
      vetCsvRow({
        date: "7/15/2025 3:45:00 PM",
        name: "Ada Lovelace",
        phone: "5551234567",
        email: "ada@example.com",
        stateZip: "NC 27513",
      }),
    ]);
    const sha = await sha256File(file);
    const fake = createRecoveryFake();
    const preview = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-preview"), fake.db);
    assert.equal(preview.report.recoveryCandidates, 1);
    assert.equal(preview.report.fileDuplicates, 1);
    const commit = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-commit"), fake.db);
    assert.equal(commit.report.appliedSourceLeadEventCreates, 1);
    assert.equal(commit.report.appliedLeadInventoryItemCreates, 1);
    assert.equal(fake.calls.sourceLeadEventCreate, 1);
    assert.equal(fake.calls.leadInventoryItemCreate, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("first EXISTING_EXACT then later same sourceLeadId is exact plus file duplicate", async () => {
  process.env.DATABASE_URL = "postgresql://sa360@127.0.0.1:5432/sa360_test";
  const dir = await mkdtemp(path.join(os.tmpdir(), "aged-recovery-"));
  try {
    const row = sampleNormalized();
    const file = await writeCsv(dir, [
      vetCsvRow({
        date: "7/15/2025 3:45:00 PM",
        name: "Ada Lovelace",
        phone: "5551234567",
        email: "ada@example.com",
        stateZip: "NC 27513",
      }),
      vetCsvRow({
        date: "7/15/2025 3:45:00 PM",
        name: "Ada Lovelace",
        phone: "5551234567",
        email: "ada@example.com",
        stateZip: "NC 27513",
      }),
    ]);
    const sha = await sha256File(file);
    const fake = createRecoveryFake({
      events: [
        {
          id: "evt-existing",
          sourceLeadId: row.sourceLeadId,
          sourceProvider: "manual_import",
          sourceSystem: "csv_import",
          normalizedPayloadJson: {},
          rawPayloadJson: {},
          enrichmentMetadataJson: {},
        },
      ],
    });
    const preview = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-preview"), fake.db);
    assert.equal(preview.report.existingExact, 1);
    assert.equal(preview.report.fileDuplicates, 1);
    assert.equal(preview.report.recoveryCandidates, 0);
    const commit = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-commit"), fake.db);
    assert.equal(commit.report.appliedSourceLeadEventCreates, 0);
    assert.equal(fake.calls.sourceLeadEventCreate, 0);
    assert.equal(fake.calls.leadInventoryItemCreate, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("first EXISTING_CONSUMER then later same sourceLeadId is existing consumer plus file duplicate", async () => {
  process.env.DATABASE_URL = "postgresql://sa360@127.0.0.1:5432/sa360_test";
  const dir = await mkdtemp(path.join(os.tmpdir(), "aged-recovery-"));
  try {
    const incoming = sampleNormalized({ dateRaw: "8/01/2025 3:45:00 PM" });
    const fps = recoveryFingerprints(incoming);
    const file = await writeCsv(dir, [
      vetCsvRow({
        date: "8/01/2025 3:45:00 PM",
        name: "Ada Lovelace",
        phone: "5551234567",
        email: "ada@example.com",
        stateZip: "NC 27513",
      }),
      vetCsvRow({
        date: "8/01/2025 3:45:00 PM",
        name: "Ada Lovelace",
        phone: "5551234567",
        email: "ada@example.com",
        stateZip: "NC 27513",
      }),
    ]);
    const sha = await sha256File(file);
    const fake = createRecoveryFake({
      events: [
        {
          id: "evt-other",
          sourceLeadId: "aged-v1-vet-differentid00000001",
          sourceProvider: "manual_import",
          sourceSystem: "csv_import",
          normalizedPayloadJson: {},
          rawPayloadJson: {},
          enrichmentMetadataJson: {},
        },
      ],
      items: [
        {
          id: "item-other",
          sourceLeadEventId: "evt-other",
          inventoryLotId: "lot-july",
          generatedAt: new Date("2025-07-15T12:00:00.000Z"),
          normalizedState: "NC",
          nicheKey: "vet",
          sourceProvider: "manual_import",
          sourceLane: "aged_inventory_bulk_csv",
          status: "available",
          phoneFingerprint: fps.phoneFingerprint,
          emailFingerprint: fps.emailFingerprint,
          metadataJson: {},
          fulfillmentCount: 0,
        },
      ],
    });
    const preview = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-preview"), fake.db);
    assert.equal(preview.report.existingConsumer, 1);
    assert.equal(preview.report.fileDuplicates, 1);
    assert.equal(preview.report.recoveryCandidates, 0);
    const commit = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-commit"), fake.db);
    assert.equal(commit.report.appliedSourceLeadEventCreates, 0);
    assert.equal(fake.calls.sourceLeadEventCreate, 0);
    assert.equal(fake.calls.leadInventoryItemCreate, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("one canonical fingerprint across multiple inventory items stays EXISTING_CONSUMER", () => {
  const phone = fingerprintIdentityValue("phone", "+15551234567");
  const email = fingerprintIdentityValue("email", "ada@example.com");
  const verdict = classifyStrongConsumerIdentity({
    phoneHits: [
      hit({ inventoryItemId: "item-a", phoneFingerprint: phone, emailFingerprint: email }),
      hit({ inventoryItemId: "item-b", phoneFingerprint: phone, emailFingerprint: email }),
    ],
    emailHits: [
      hit({ inventoryItemId: "item-a", phoneFingerprint: phone, emailFingerprint: email }),
      hit({ inventoryItemId: "item-b", phoneFingerprint: phone, emailFingerprint: email }),
    ],
  });
  assert.equal(verdict.kind, "existing_consumer");
  if (verdict.kind === "existing_consumer") {
    assert.equal(verdict.hits.length, 2);
  }
  const row = sampleNormalized();
  assert.equal(
    classifyRecoveryRowDecision({
      row,
      exactSourceExists: false,
      consumer: verdict,
    }),
    "EXISTING_CONSUMER"
  );
});

test("invalid row and later file duplicate never create", async () => {
  process.env.DATABASE_URL = "postgresql://sa360@127.0.0.1:5432/sa360_test";
  const dir = await mkdtemp(path.join(os.tmpdir(), "aged-recovery-"));
  try {
    const file = await writeCsv(dir, [
      vetCsvRow({
        date: "7/15/2025 3:45:00 PM",
        name: "NoState Person",
        phone: "5552223333",
        email: "nostate@example.com",
        stateZip: "ZZ 00000",
      }),
      vetCsvRow({
        date: "7/15/2025 3:45:00 PM",
        name: "Ada Lovelace",
        phone: "5551234567",
        email: "ada@example.com",
        stateZip: "NC 27513",
      }),
      vetCsvRow({
        date: "7/15/2025 3:45:00 PM",
        name: "Ada Lovelace",
        phone: "5551234567",
        email: "ada@example.com",
        stateZip: "NC 27513",
      }),
    ]);
    const sha = await sha256File(file);
    const fake = createRecoveryFake();
    const preview = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-preview"), fake.db);
    assert.equal(preview.report.invalidRows, 1);
    assert.equal(preview.report.invalidDisposition.reject_invalid_state, 1);
    assert.equal(preview.report.fileDuplicates, 1);
    assert.equal(preview.report.recoveryCandidates, 1);
    const commit = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-commit"), fake.db);
    assert.equal(commit.report.appliedLeadInventoryItemCreates, 1);
    assert.equal(fake.events.size, 1);
    assert.equal(fake.items.size, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("valid unique candidate is proposed and historical vs post-snapshot groupings are assigned", async () => {
  process.env.DATABASE_URL = "postgresql://sa360@127.0.0.1:5432/sa360_test";
  const dir = await mkdtemp(path.join(os.tmpdir(), "aged-recovery-"));
  try {
    const historical = sampleNormalized({ dateRaw: "7/21/2026 3:45:00 PM", phoneRaw: "5551111111", emailRaw: "hist@example.com", clientNameRaw: "Hist Person" });
    const post = sampleNormalized({ dateRaw: "8/01/2026 3:45:00 PM", phoneRaw: "5552222222", emailRaw: "post@example.com", clientNameRaw: "Post Person" });
    assert.equal(assignRecoveryGrouping(historical.generatedAt), "HISTORICAL_PARSER_RECOVERY");
    assert.equal(assignRecoveryGrouping(post.generatedAt), "POST_SNAPSHOT_MASTER_DELTA");
    assert.equal(generatedDateIso(historical.generatedAt) <= "2026-07-29", true);

    const file = await writeCsv(dir, [
      vetCsvRow({
        date: "7/21/2026 3:45:00 PM",
        name: "Hist Person",
        phone: "5551111111",
        email: "hist@example.com",
        stateZip: "NC 27513",
      }),
      vetCsvRow({
        date: "8/01/2026 3:45:00 PM",
        name: "Post Person",
        phone: "5552222222",
        email: "post@example.com",
        stateZip: "TX 75001",
      }),
    ]);
    const sha = await sha256File(file);
    const fake = createRecoveryFake();
    const preview = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-preview"), fake.db);
    assert.equal(preview.report.recoveryCandidates, 2);
    assert.equal(preview.report.historicalParserRecovery, 1);
    assert.equal(preview.report.postSnapshotMasterDelta, 1);
    assert.equal(preview.report.proposedSourceLeadEventCreates, 2);
    assert.equal(preview.report.appliedSourceLeadEventCreates, 0);
    assert.equal(preview.lots.every((lot) => lot.lotId === null), true);

    const commit = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-commit"), fake.db);
    assert.equal(commit.report.appliedSourceLeadEventCreates, 2);
    assert.equal(commit.report.appliedLeadInventoryItemCreates, 2);
    assert.equal(fake.calls.leadAllocationCreate, 0);
    assert.equal(fake.calls.buyerDeliveredIdentityCreate, 0);
    assert.equal(fake.calls.exportPackageCreate, 0);
    assert.equal(fake.lots.size, 2);
    const createdItems = [...fake.items.values()];
    assert.equal(createdItems.every((item) => item.status === "pending_review"), true);
    const createdEvents = [...fake.events.values()];
    assert.equal(
      createdEvents.every((event) => String(event.sourceRouteKey ?? "").startsWith("AGED_BULK_RECOVERY::")),
      true
    );
    const histLot = [...fake.lots.values()].find((lot) => lot.lotKey.includes("historical_parser"));
    const postLot = [...fake.lots.values()].find((lot) => lot.lotKey.includes("post_snapshot"));
    assert.ok(histLot);
    assert.ok(postLot);
    assert.equal(histLot?.metadataJson.recoveryReason, "HISTORICAL_PARSER_RECOVERY");
    assert.equal(postLot?.metadataJson.recoveryReason, "POST_SNAPSHOT_MASTER_DELTA");
    assert.equal(histLot?.metadataJson.dateCut, "2026-07-29");
    assert.equal(histLot?.metadataJson.sourceFormat, "vet_master_v1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SourceLeadEvent and LeadInventoryItem create atomically and repeat commit is idempotent", async () => {
  process.env.DATABASE_URL = "postgresql://sa360@127.0.0.1:5432/sa360_test";
  const dir = await mkdtemp(path.join(os.tmpdir(), "aged-recovery-"));
  try {
    const file = await writeCsv(dir, [
      vetCsvRow({
        date: "7/15/2025 3:45:00 PM",
        name: "Ada Lovelace",
        phone: "5551234567",
        email: "ada@example.com",
        stateZip: "NC 27513",
      }),
    ]);
    const sha = await sha256File(file);
    const fake = createRecoveryFake();
    fake.failNextItemCreateOnce();
    await assert.rejects(
      () => runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-commit"), fake.db),
      /forced_item_create_failure/
    );
    assert.equal(fake.events.size, 0);
    assert.equal(fake.items.size, 0);

    const first = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-commit"), fake.db);
    assert.equal(first.report.appliedSourceLeadEventCreates, 1);
    assert.equal(first.report.appliedLeadInventoryItemCreates, 1);
    assert.equal(fake.events.size, 1);
    assert.equal(fake.items.size, 1);
    const eventId = [...fake.events.keys()][0];
    const item = [...fake.items.values()][0];
    assert.equal(item?.sourceLeadEventId, eventId);

    const second = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-commit"), fake.db);
    assert.equal(second.report.existingExact, 1);
    assert.equal(second.report.appliedSourceLeadEventCreates, 0);
    assert.equal(fake.events.size, 1);
    assert.equal(fake.items.size, 1);
    assert.equal(fake.calls.leadAllocationCreate, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("race where consumer or exact source appears between preview and create is skipped", async () => {
  process.env.DATABASE_URL = "postgresql://sa360@127.0.0.1:5432/sa360_test";
  const dir = await mkdtemp(path.join(os.tmpdir(), "aged-recovery-"));
  try {
    const consumerRow = sampleNormalized({
      phoneRaw: "5553334444",
      emailRaw: "race-consumer@example.com",
      clientNameRaw: "Race Consumer",
    });
    const exactRow = sampleNormalized({
      phoneRaw: "5555556666",
      emailRaw: "race-exact@example.com",
      clientNameRaw: "Race Exact",
    });
    const file = await writeCsv(dir, [
      vetCsvRow({
        date: "7/15/2025 3:45:00 PM",
        name: "Race Consumer",
        phone: "5553334444",
        email: "race-consumer@example.com",
        stateZip: "NC 27513",
      }),
      vetCsvRow({
        date: "7/15/2025 3:45:00 PM",
        name: "Race Exact",
        phone: "5555556666",
        email: "race-exact@example.com",
        stateZip: "TX 75001",
      }),
    ]);
    const sha = await sha256File(file);
    const fake = createRecoveryFake();
    const preview = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-preview"), fake.db);
    assert.equal(preview.report.recoveryCandidates, 2);
    assert.equal(preview.report.appliedLeadInventoryItemCreates, 0);

    const consumerFp = recoveryFingerprints(consumerRow);
    fake.onNextTransactions([
      () => {
        fake.addEvent({
          id: "evt-race-consumer",
          sourceLeadId: "aged-v1-vet-intakeinserted000001",
          sourceProvider: "leadcapture",
          sourceSystem: "webhook",
          normalizedPayloadJson: {},
          rawPayloadJson: {},
          enrichmentMetadataJson: {},
        });
        fake.addItem({
          id: "item-race-consumer",
          sourceLeadEventId: "evt-race-consumer",
          inventoryLotId: "lot-campaign",
          generatedAt: new Date("2026-08-01T12:00:00.000Z"),
          normalizedState: "NC",
          nicheKey: "vet",
          sourceProvider: "leadcapture",
          sourceLane: "campaign_webhook",
          status: "available",
          phoneFingerprint: consumerFp.phoneFingerprint,
          emailFingerprint: consumerFp.emailFingerprint,
          metadataJson: {},
          fulfillmentCount: 0,
        });
      },
      () => {
        fake.addEvent({
          id: "evt-race-exact",
          sourceLeadId: exactRow.sourceLeadId,
          sourceProvider: "manual_import",
          sourceSystem: "csv_import",
          normalizedPayloadJson: {},
          rawPayloadJson: {},
          enrichmentMetadataJson: {},
        });
      },
    ]);

    const commit = await runAgedInventoryBulkRecovery(baseArgs(file, sha, dir, "recovery-commit"), fake.db);
    assert.equal(commit.report.appliedSourceLeadEventCreates, 0);
    assert.equal(commit.report.skippedRaceDetected, 2);
    assert.equal(fake.calls.advisoryLocks > 0, true);
    assert.equal(
      [...fake.items.values()].some((item) => item.id.startsWith("item-new-")),
      false
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recovered payload keeps canonical enrichment, parser generatedAt, distinct consumer_age, and buyer CSV v3 readability", () => {
  const row = sampleNormalized({
    dateRaw: "46224.75",
    dobAgeRaw: "05/13/1979",
    ageRaw: "05/13/1979",
  });
  assert.match(row.sourceLeadId, /^aged-v1-vet-[a-f0-9]{24}$/);
  assert.equal(row.generatedAt.toISOString(), "2026-07-21T18:00:00.000Z");
  assert.notEqual(row.consumerAge, null);
  const payload = buildAgedBulkNormalizedPayload(row);
  assert.equal(payload.firstName, "Ada");
  assert.equal((payload.contact as { zip: string | null }).zip, "27513");
  assert.equal((payload.lead_details as { consumer_age: number | null }).consumer_age, row.consumerAge);
  assert.equal((payload.lead_details as { niche: { branch_of_service?: string } }).niche.branch_of_service, "Army");
  const csv = extractBuyerCsvV3Fields({
    normalizedPayloadJson: payload,
    generatedAt: row.generatedAt,
    nicheKey: "vet",
  });
  assert.equal(csv.zip, "27513");
  assert.equal(csv.age, String(row.consumerAge));
  assert.equal(csv.lead_date, "2026-07-21");
  assert.equal(csv.branch_of_service, "Army");
  assert.equal(csv.disability_rating, "40%");
  assert.equal(csv.primary_concern, "Income");
  assert.equal(csv.beneficiary, "Spouse");
  assert.equal("Used By" in csv, false);
  assert.equal("campaign_name" in csv && Boolean((csv as { campaign_name?: string }).campaign_name), false);

  const accepted = classifyRecoveryRowDecision({
    row,
    exactSourceExists: false,
    consumer: { kind: "none" },
  });
  assert.equal(accepted, "RECOVERY_CANDIDATE");
});

test("recovery-commit rejects ordinary or enrich confirmation phrases", async () => {
  process.env.DATABASE_URL = "postgresql://sa360@127.0.0.1:5432/sa360_test";
  const dir = await mkdtemp(path.join(os.tmpdir(), "aged-recovery-"));
  try {
    const file = await writeCsv(dir, [
      vetCsvRow({
        date: "7/15/2025 3:45:00 PM",
        name: "Ada Lovelace",
        phone: "5551234567",
        email: "ada@example.com",
        stateZip: "NC 27513",
      }),
    ]);
    const sha = await sha256File(file);
    const fake = createRecoveryFake();
    const args = baseArgs(file, sha, dir, "recovery-commit");
    args.confirmation = "ENRICH HISTORICAL MASTER INVENTORY";
    await assert.rejects(() => runAgedInventoryBulkRecovery(args, fake.db), /invalid_recovery_confirmation/);
    args.confirmation = "IMPORT ONE AGED LEAD INVENTORY BATCH";
    await assert.rejects(() => runAgedInventoryBulkRecovery(args, fake.db), /invalid_recovery_confirmation/);
    assert.equal(fake.calls.sourceLeadEventCreate, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
