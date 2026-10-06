import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  BUYER_EXPORT_AGE_REQUIRED,
  SPREADSHEET_DELIVERY_CONFIRM_PHRASE,
  auditPackageAgeColumn,
  commitBuyerCsvExport,
  countBlankAgeCellsInCsv,
  getBuyerCsvExportDownload,
  markSpreadsheetDelivered,
  parseCsvDocument,
  previewBuyerCsvExport,
} from "./buyer-csv-export.service.js";
import {
  buyerCsvColumnsForNiche,
  readOptionalBuyerSalesContextFields,
} from "./buyer-lead-fields.js";

const originalFlag = process.env.SA360_PPL_CSV_EXPORT_ENABLED;

afterEach(() => {
  if (originalFlag === undefined) delete process.env.SA360_PPL_CSV_EXPORT_ENABLED;
  else process.env.SA360_PPL_CSV_EXPORT_ENABLED = originalFlag;
});

type AllocationSpec = {
  id: string;
  /** Canonical nest age. Omit to leave the canonical cell blank. */
  age?: string | number;
  /** Only reachable through rawPayloadJson — the LO-1055 recovery shape. */
  rawAge?: string;
  dateOfBirth?: string;
  metadataAge?: string;
  beneficiary?: string;
  primaryConcern?: string;
  primaryReason?: string;
  customFields?: Record<string, string>;
  /** Raw, un-normalized payload state, e.g. "Georgia". */
  payloadState?: string;
  /** Canonical LeadInventoryItem.normalizedState. */
  normalizedState?: string;
  nicheKey?: string;
};

function allocation(spec: AllocationSpec) {
  const leadDetails: Record<string, unknown> = {
    ...(spec.age == null ? {} : { consumer_age: spec.age }),
    ...(spec.dateOfBirth ? { date_of_birth: spec.dateOfBirth } : {}),
    ...(spec.beneficiary ? { beneficiary: spec.beneficiary } : {}),
    niche: {
      branch_of_service: "Army",
      ...(spec.primaryConcern ? { primary_concern: spec.primaryConcern } : {}),
      ...(spec.primaryReason ? { primary_reason: spec.primaryReason } : {}),
    },
  };
  return {
    id: spec.id,
    status: "reserved" as const,
    sourceLeadEventId: `evt_${spec.id}`,
    leadInventoryItemId: `item_${spec.id}`,
    sourceLeadEvent: {
      normalizedPayloadJson: {
        contact: {
          first_name: "Ada",
          last_name: "Lovelace",
          phone_e164: "+15551234567",
          email: `${spec.id}@example.com`,
          state: spec.payloadState ?? "NC",
        },
        lead_details: leadDetails,
        ...(spec.customFields ? { custom_fields: spec.customFields } : {}),
      },
      rawPayloadJson: spec.rawAge ? { master: { dob_age_raw: spec.rawAge } } : {},
      enrichmentMetadataJson: {},
    },
    leadInventoryItem: {
      id: `item_${spec.id}`,
      generatedAt: new Date("2024-06-15T00:00:00.000Z"),
      nicheKey: spec.nicheKey ?? "vet",
      status: "reserved",
      normalizedState: spec.normalizedState ?? "NC",
      metadataJson: spec.metadataAge ? { consumer_age: spec.metadataAge } : {},
    },
    proposedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function exportDb(allocations: ReturnType<typeof allocation>[], nicheKey = "vet") {
  return {
    leadOrder: {
      findUnique: async () => ({
        id: "ord_1",
        clientAccountId: "acct_a",
        clientDisplayName: "Valley Vet",
        orderNumber: "1001",
        requestedQuantity: allocations.length,
        nicheKey,
        statesJson: ["NC"],
      }),
    },
    leadAllocation: { findMany: async () => allocations },
  };
}

function commitDbFor(
  allocations: ReturnType<typeof allocation>[],
  created: Array<Record<string, unknown>>,
  nicheKey = "vet"
) {
  const db: Record<string, unknown> = {
    ...exportDb(allocations, nicheKey),
    leadOrderLine: { findFirst: async () => null },
    leadDeliveryExportPackage: {
      findUnique: async () => null,
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return { id: "pkg_new", ...args.data };
      },
    },
  };
  db.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return db;
}

function headerOf(csv: string): string[] {
  return csv.split("\n")[0]!.split(",");
}

function cellsOf(csv: string, rowIndex = 1): string[] {
  return csv.split("\n")[rowIndex]!.split(",");
}

function cell(csv: string, column: string, rowIndex = 1): string {
  return cellsOf(csv, rowIndex)[headerOf(csv).indexOf(column)] ?? "";
}

describe("buyer CSV export fails closed without consumer age", () => {
  it("blocks preview when an allocation has no resolvable age", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    const preview = await previewBuyerCsvExport(
      { orderId: "ord_1" },
      exportDb([allocation({ id: "a", age: 62 }), allocation({ id: "b" })]) as never
    );
    assert.equal(preview.ok, false);
    if (preview.ok) return;
    assert.equal(preview.code, BUYER_EXPORT_AGE_REQUIRED);
    assert.deepEqual(preview.details, {
      rowCount: 2,
      ageMissing: 1,
      ageInvalid: 0,
      ageOverMaximum: 0,
    });
  });

  it("blocks preview for an unusable age and for an age over the maximum", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    const preview = await previewBuyerCsvExport(
      { orderId: "ord_1" },
      exportDb([
        allocation({ id: "a", age: 86 }),
        allocation({ id: "b", age: 87 }),
        allocation({ id: "c", age: "not-an-age" }),
      ]) as never
    );
    assert.equal(preview.ok, false);
    if (preview.ok) return;
    assert.deepEqual(preview.details, {
      rowCount: 3,
      ageMissing: 0,
      ageInvalid: 1,
      ageOverMaximum: 1,
    });
  });

  it("reports aggregate counts only — no identities or payloads leak", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    const preview = await previewBuyerCsvExport(
      { orderId: "ord_1" },
      exportDb([allocation({ id: "leaky" })]) as never
    );
    assert.equal(preview.ok, false);
    if (preview.ok) return;
    const serialized = JSON.stringify(preview);
    assert.equal(serialized.includes("@example.com"), false);
    assert.equal(serialized.includes("+1555"), false);
    assert.equal(serialized.includes("Lovelace"), false);
    assert.equal(serialized.includes("leaky"), false);
  });

  it("blocks commit and persists no package", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    const created: Array<Record<string, unknown>> = [];
    const commit = await commitBuyerCsvExport(
      { orderId: "ord_1", idempotencyKey: "k-age-blocked" },
      commitDbFor([allocation({ id: "a" })], created) as never
    );
    assert.equal(commit.ok, false);
    if (commit.ok) return;
    assert.equal(commit.code, BUYER_EXPORT_AGE_REQUIRED);
    assert.deepEqual(created, [], "no immutable package may be written");
  });

  it("enforces age on a life-insurance niche still built on a schema with no Age column", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    // `nurse_life` is a historical alias order niche that still resolves to
    // buyer_csv_v2. The age policy follows the canonical commerce niche, so
    // "this schema has no Age column" must not mean "age does not apply".
    const preview = await previewBuyerCsvExport(
      { orderId: "ord_1" },
      exportDb([allocation({ id: "a", nicheKey: "nurse_life" })], "nurse_life") as never
    );
    assert.equal(preview.ok, false);
    if (preview.ok) return;
    assert.equal(preview.code, BUYER_EXPORT_AGE_REQUIRED);
    assert.deepEqual(preview.details, {
      rowCount: 1,
      ageMissing: 1,
      ageInvalid: 0,
      ageOverMaximum: 0,
    });
  });

  it("blocks an over-maximum age on a v2 life-insurance niche too", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    const preview = await previewBuyerCsvExport(
      { orderId: "ord_1" },
      exportDb([allocation({ id: "a", age: 87, nicheKey: "vet_fex" })], "vet_fex") as never
    );
    assert.equal(preview.ok, false);
    if (preview.ok) return;
    assert.equal(preview.code, BUYER_EXPORT_AGE_REQUIRED);
    assert.deepEqual(preview.details, {
      rowCount: 1,
      ageMissing: 0,
      ageInvalid: 0,
      ageOverMaximum: 1,
    });
  });

  it("leaves a non-life-insurance v2 niche on its historical contract", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    // Mortgage is not live life-insurance commerce, so a blank age neither
    // blocks the export nor adds an Age column.
    const preview = await previewBuyerCsvExport(
      { orderId: "ord_1" },
      exportDb([allocation({ id: "a", nicheKey: "mortgage" })], "mortgage") as never
    );
    assert.equal(preview.ok, true);
    if (!preview.ok || !("columns" in preview)) return;
    assert.equal(preview.fieldSchemaVersion, "buyer_csv_v2");
    assert.equal(preview.columns.includes("age"), false);
    assert.deepEqual([...preview.columns], buyerCsvColumnsForNiche("mortgage"));
  });
});

describe("buyer CSV export guarantees Age for every row", () => {
  it("recovers an age that exists only in the raw payload (LO-1055 shape)", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    const created: Array<Record<string, unknown>> = [];
    const commit = await commitBuyerCsvExport(
      { orderId: "ord_1", idempotencyKey: "k-raw-age" },
      commitDbFor([allocation({ id: "a", rawAge: "70" })], created) as never
    );
    assert.equal(commit.ok, true);
    const csv = created[0]!.csvContent as string;
    assert.equal(cell(csv, "Age"), "70");
    assert.equal(countBlankAgeCellsInCsv(csv), 0);
  });

  it("recovers an age that exists only in inventory metadata", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    const created: Array<Record<string, unknown>> = [];
    await commitBuyerCsvExport(
      { orderId: "ord_1", idempotencyKey: "k-meta-age" },
      commitDbFor([allocation({ id: "a", metadataAge: "64" })], created) as never
    );
    assert.equal(cell(created[0]!.csvContent as string, "Age"), "64");
  });

  it("recomputes age from a date of birth and never exports the date of birth", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    const dob = new Date();
    dob.setUTCFullYear(dob.getUTCFullYear() - 71);
    dob.setUTCDate(dob.getUTCDate() - 1);
    const iso = dob.toISOString().slice(0, 10);

    const created: Array<Record<string, unknown>> = [];
    await commitBuyerCsvExport(
      { orderId: "ord_1", idempotencyKey: "k-dob" },
      // A stale stored age must not beat the date of birth.
      commitDbFor([allocation({ id: "a", age: 60, dateOfBirth: iso })], created) as never
    );
    const csv = created[0]!.csvContent as string;
    assert.equal(cell(csv, "Age"), "71");
    assert.equal(headerOf(csv).includes("Date of Birth"), false);
    assert.equal(csv.includes(iso), false);
  });

  it("never derives Age from the lead generated date", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    const preview = await previewBuyerCsvExport(
      { orderId: "ord_1" },
      exportDb([allocation({ id: "a" })]) as never
    );
    // generatedAt is 2024-06-15; a lead-age-derived value would have passed.
    assert.equal(preview.ok, false);
    if (preview.ok) return;
    assert.equal(preview.code, BUYER_EXPORT_AGE_REQUIRED);
  });
});

async function committedCsv(
  allocations: ReturnType<typeof allocation>[],
  idempotencyKey: string,
  nicheKey = "vet"
) {
  const created: Array<Record<string, unknown>> = [];
  const commit = await commitBuyerCsvExport(
    { orderId: "ord_1", idempotencyKey },
    commitDbFor(allocations, created, nicheKey) as never
  );
  return { commit, created, csv: (created[0]?.csvContent as string | undefined) ?? null };
}

/**
 * Age guarantee matrix. Veteran and Trucker behaviour is unchanged; Nurse is
 * held to the identical contract now that it exports through the customer
 * presentation schema.
 */
describe("every live life-insurance niche guarantees Age", () => {
  for (const nicheKey of ["vet", "nurse", "trucker"] as const) {
    it(`${nicheKey}: a new export carries a populated Age column`, async () => {
      process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
      const { commit, csv } = await committedCsv(
        [allocation({ id: "a", age: 62, nicheKey })],
        `k-${nicheKey}-age`,
        nicheKey
      );
      assert.equal(commit.ok, true);
      if (!commit.ok) return;
      assert.equal(commit.fieldSchemaVersion, "buyer_csv_v4");
      assert.equal(headerOf(csv!).includes("Age"), true);
      assert.equal(cell(csv!, "Age"), "62");
      assert.equal(countBlankAgeCellsInCsv(csv!), 0);
    });

    it(`${nicheKey}: age 86 is allowed`, async () => {
      process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
      const { commit, csv } = await committedCsv(
        [allocation({ id: "a", age: 86, nicheKey })],
        `k-${nicheKey}-86`,
        nicheKey
      );
      assert.equal(commit.ok, true);
      assert.equal(cell(csv!, "Age"), "86");
    });

    it(`${nicheKey}: age 87 is blocked at preview and persists no package`, async () => {
      process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
      const preview = await previewBuyerCsvExport(
        { orderId: "ord_1" },
        exportDb([allocation({ id: "a", age: 87, nicheKey })], nicheKey) as never
      );
      assert.equal(preview.ok, false);
      if (preview.ok) return;
      assert.equal(preview.code, BUYER_EXPORT_AGE_REQUIRED);
      assert.deepEqual(preview.details, {
        rowCount: 1,
        ageMissing: 0,
        ageInvalid: 0,
        ageOverMaximum: 1,
      });

      const { commit, created } = await committedCsv(
        [allocation({ id: "a", age: 87, nicheKey })],
        `k-${nicheKey}-87`,
        nicheKey
      );
      assert.equal(commit.ok, false);
      assert.deepEqual(created, [], "no immutable package may be written");
    });

    it(`${nicheKey}: a missing age is blocked at preview and commit`, async () => {
      process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
      const preview = await previewBuyerCsvExport(
        { orderId: "ord_1" },
        exportDb([allocation({ id: "a", nicheKey })], nicheKey) as never
      );
      assert.equal(preview.ok, false);
      if (!preview.ok) assert.equal(preview.code, BUYER_EXPORT_AGE_REQUIRED);

      const { commit, created } = await committedCsv(
        [allocation({ id: "a", nicheKey })],
        `k-${nicheKey}-missing`,
        nicheKey
      );
      assert.equal(commit.ok, false);
      if (!commit.ok) assert.equal(commit.code, BUYER_EXPORT_AGE_REQUIRED);
      assert.deepEqual(created, []);
    });

    it(`${nicheKey}: an unusable age is blocked`, async () => {
      process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
      const preview = await previewBuyerCsvExport(
        { orderId: "ord_1" },
        exportDb([allocation({ id: "a", age: "not-an-age", nicheKey })], nicheKey) as never
      );
      assert.equal(preview.ok, false);
      if (preview.ok) return;
      assert.deepEqual(preview.details, {
        rowCount: 1,
        ageMissing: 0,
        ageInvalid: 1,
        ageOverMaximum: 0,
      });
    });

    it(`${nicheKey}: a date of birth is never exported`, async () => {
      process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
      const dob = new Date();
      dob.setUTCFullYear(dob.getUTCFullYear() - 68);
      dob.setUTCDate(dob.getUTCDate() - 1);
      const iso = dob.toISOString().slice(0, 10);
      const { csv } = await committedCsv(
        [allocation({ id: "a", dateOfBirth: iso, nicheKey })],
        `k-${nicheKey}-dob`,
        nicheKey
      );
      assert.equal(cell(csv!, "Age"), "68");
      assert.equal(headerOf(csv!).includes("Date of Birth"), false);
      assert.equal(csv!.includes(iso), false);
    });
  }
});

describe("buyer CSV presentation semantics", () => {
  it("exports the canonical normalized state, not the raw source state", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    const created: Array<Record<string, unknown>> = [];
    await commitBuyerCsvExport(
      { orderId: "ord_1", idempotencyKey: "k-state" },
      commitDbFor(
        [
          allocation({ id: "a", age: 62, payloadState: "Georgia", normalizedState: "GA" }),
          allocation({ id: "b", age: 63, payloadState: "n c", normalizedState: "NC" }),
          allocation({ id: "c", age: 64, payloadState: "Texas3", normalizedState: "TX" }),
          allocation({ id: "d", age: 65, payloadState: "S.C.", normalizedState: "SC" }),
        ],
        created
      ) as never
    );
    const csv = created[0]!.csvContent as string;
    const states = [1, 2, 3, 4].map((row) => cell(csv, "State", row));
    assert.deepEqual([...states].sort(), ["GA", "NC", "SC", "TX"]);
    for (const raw of ["Georgia", "n c", "Texas3", "S.C."]) {
      assert.equal(csv.includes(raw), false, `raw state ${raw} must not reach the buyer`);
    }
  });

  it("presents a blank beneficiary as Other without writing it back", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    const created: Array<Record<string, unknown>> = [];
    const allocations = [
      allocation({ id: "a", age: 62 }),
      allocation({ id: "b", age: 63, beneficiary: "Spouse" }),
    ];
    const payloadBefore = JSON.stringify(allocations[0]!.sourceLeadEvent.normalizedPayloadJson);
    await commitBuyerCsvExport(
      { orderId: "ord_1", idempotencyKey: "k-beneficiary" },
      commitDbFor(allocations, created) as never
    );
    const csv = created[0]!.csvContent as string;
    assert.equal(cell(csv, "Beneficiary", 1), "Other");
    assert.equal(cell(csv, "Beneficiary", 2), "Spouse");

    assert.equal(
      JSON.stringify(allocations[0]!.sourceLeadEvent.normalizedPayloadJson),
      payloadBefore,
      "presentation must not write Other into normalizedPayloadJson"
    );
    assert.equal(
      readOptionalBuyerSalesContextFields(allocations[0]!.sourceLeadEvent.normalizedPayloadJson)
        .beneficiary,
      "",
      "the canonical beneficiary stays unanswered"
    );
  });

  it("keeps Primary Reason distinct from Primary Concern", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    const created: Array<Record<string, unknown>> = [];
    await commitBuyerCsvExport(
      { orderId: "ord_1", idempotencyKey: "k-reason" },
      commitDbFor(
        [allocation({ id: "a", age: 62, primaryReason: "final_expense" })],
        created
      ) as never
    );
    const csv = created[0]!.csvContent as string;
    assert.equal(headerOf(csv).includes("Primary Reason"), true);
    assert.equal(cell(csv, "Primary Reason"), "final_expense");
    assert.equal(
      cell(csv, "Primary Concern"),
      "",
      "a stated reason must never be relabelled as a concern"
    );
  });

  it("does not alias primary_reason into primary_concern when read from any source bag", () => {
    for (const payload of [
      { lead_details: { niche: { primary_reason: "final_expense" } } },
      { custom_fields: { "Primary Reason": "final_expense" } },
      { routing: { source_intake: { custom_fields: { reason_for_insurance: "final_expense" } } } },
      { sourceAttributes: { primary_reason: "final_expense" } },
    ]) {
      const fields = readOptionalBuyerSalesContextFields(payload);
      assert.equal(fields.primary_reason, "final_expense", JSON.stringify(payload));
      assert.equal(fields.primary_concern, "", JSON.stringify(payload));
    }
  });

  it("reads buyer enrichment parked in Meta custom_fields", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    const created: Array<Record<string, unknown>> = [];
    await commitBuyerCsvExport(
      { orderId: "ord_1", idempotencyKey: "k-custom-fields" },
      commitDbFor(
        [
          allocation({
            id: "a",
            age: 62,
            customFields: {
              "Coverage Amount": "25000",
              "VA Disability Rating": "70%",
              "Primary Concern": "Income protection",
            },
          }),
        ],
        created
      ) as never
    );
    const csv = created[0]!.csvContent as string;
    assert.equal(cell(csv, "Coverage Amount"), "25000");
    assert.equal(cell(csv, "Disability Rating"), "70%");
    assert.equal(cell(csv, "Primary Concern"), "Income protection");
  });
});

describe("spreadsheet release requires a complete Age column", () => {
  const presented =
    "Date Generated,Lead Type,First Name,Last Name,Phone,Email,State,Age,Beneficiary\n" +
    "2024-06-15,Veteran,Ada,Lovelace,+15551234567,ada@example.com,NC,62,Other\n";
  const withHole =
    "Date Generated,Lead Type,First Name,Last Name,Phone,Email,State,Age,Beneficiary\n" +
    "2024-06-15,Veteran,Ada,Lovelace,+15551234567,ada@example.com,NC,62,Other\n" +
    "2024-06-14,Veteran,Rex,Stout,+15551234568,rex@example.com,NC,,Other\n";

  /** Historical nurse buyer_csv_v2 bytes: no Age column exists at all. */
  const nurseV2Package =
    "first_name,last_name,phone,email,state,lead_date,niche,beneficiary,coverage_amount," +
    "healthcare_profession,primary_concern\n" +
    "Ada,Lovelace,+15551234567,ada@example.com,NC,2024-06-15,nurse,Spouse,25000,RN,Income\n";

  function releaseDb(packageRow: Record<string, unknown>) {
    return {
      leadDeliveryExportPackage: {
        findUnique: async (args: { where: Record<string, unknown> }) =>
          "spreadsheetDeliveryIdempotencyKey" in args.where ? null : packageRow,
      },
    };
  }

  function unreleasedPackage(overrides: Record<string, unknown>) {
    return {
      id: "pkg_x",
      leadOrderId: "ord_1",
      clientAccountId: "acct_a",
      contentSha256: "sha",
      rowCount: 1,
      allocationIdsJson: ["alloc_a"],
      spreadsheetDeliveredAt: null,
      ...overrides,
    };
  }

  it("counts blank Age cells only when the package has an Age column", () => {
    assert.equal(countBlankAgeCellsInCsv(presented), 0);
    assert.equal(countBlankAgeCellsInCsv(withHole), 1);
    assert.equal(countBlankAgeCellsInCsv("first_name,last_name\nAda,Lovelace\n"), 0);
    assert.equal(countBlankAgeCellsInCsv(""), 0);
  });

  it("reads a populated Age across a quoted cell that contains a newline", () => {
    const multiline =
      "Date Generated,Lead Type,First Name,Last Name,Phone,Email,State,Age,Beneficiary,Primary Concern\n" +
      "2024-06-15,Veteran,Ada,Lovelace,+15551234567,ada@example.com,NC,62,Other," +
      '"Concern line one\nConcern line two"\n';
    // A document-level split on raw newlines used to shear this record in two
    // and report the populated Age cell as blank.
    assert.equal(countBlankAgeCellsInCsv(multiline), 0);
    const audit = auditPackageAgeColumn(multiline, "vet");
    assert.equal(audit.ok, true);
    assert.equal(audit.ageColumnPresent, true);
    assert.equal(audit.blankAgeCells, 0);
    const records = parseCsvDocument(multiline);
    assert.equal(records.length, 2);
    assert.equal(records[1]![9], "Concern line one\nConcern line two");
  });

  it("still detects a genuine Age hole alongside a quoted newline", () => {
    const multilineHole =
      "Date Generated,Lead Type,First Name,Last Name,Phone,Email,State,Age,Beneficiary,Primary Concern\n" +
      '2024-06-15,Veteran,Ada,Lovelace,+15551234567,ada@example.com,NC,,Other,"a\nb"\n';
    assert.equal(countBlankAgeCellsInCsv(multilineHole), 1);
  });

  it("refuses to release a package whose Age column has holes", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    const result = await markSpreadsheetDelivered(
      {
        exportId: "pkg_hole",
        confirmationPhrase: SPREADSHEET_DELIVERY_CONFIRM_PHRASE,
        idempotencyKey: "rel-hole",
      },
      releaseDb(
        unreleasedPackage({
          id: "pkg_hole",
          rowCount: 2,
          csvContent: withHole,
          allocationIdsJson: ["alloc_a", "alloc_b"],
          leadOrder: { nicheKey: "vet" },
        })
      ) as never
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, BUYER_EXPORT_AGE_REQUIRED);
    assert.deepEqual(result.details, {
      rowCount: 2,
      ageColumnPresent: true,
      blankAgeCells: 1,
    });
  });

  it("refuses to release a life-insurance package that has no Age column at all", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    for (const nicheSource of [
      { leadOrder: { nicheKey: "nurse" } },
      { metadataJson: { niche: "nurse_life" }, leadOrder: { nicheKey: "nurse_life" } },
    ]) {
      const result = await markSpreadsheetDelivered(
        {
          exportId: "pkg_nurse_v2",
          confirmationPhrase: SPREADSHEET_DELIVERY_CONFIRM_PHRASE,
          idempotencyKey: "rel-nurse-v2",
        },
        releaseDb(
          unreleasedPackage({
            id: "pkg_nurse_v2",
            csvContent: nurseV2Package,
            ...nicheSource,
          })
        ) as never
      );
      assert.equal(result.ok, false, JSON.stringify(nicheSource));
      if (result.ok) return;
      assert.equal(result.code, BUYER_EXPORT_AGE_REQUIRED);
      assert.deepEqual(result.details, {
        rowCount: 1,
        ageColumnPresent: false,
        blankAgeCells: 0,
      });
    }
  });

  it("does not require an Age column for a non-life-insurance package", () => {
    const mortgageV2 =
      "first_name,last_name,phone,email,state,lead_date,niche,beneficiary," +
      "coverage_amount,homeowner,house_type\n" +
      "Ada,Lovelace,+15551234567,ada@example.com,NC,2024-06-15,mortgage,Spouse,25000,Yes,Single\n";
    assert.equal(auditPackageAgeColumn(mortgageV2, "mortgage").ok, true);
    assert.equal(auditPackageAgeColumn(nurseV2Package, "nurse").ok, false);
    assert.equal(auditPackageAgeColumn(nurseV2Package, "nurse").ageRequired, true);
    assert.equal(auditPackageAgeColumn(mortgageV2, "mortgage").ageRequired, false);
  });

  it("leaves an already delivered historical package untouched", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    const deliveredAt = new Date("2026-09-01T00:00:00.000Z");
    const result = await markSpreadsheetDelivered(
      {
        exportId: "pkg_delivered",
        confirmationPhrase: SPREADSHEET_DELIVERY_CONFIRM_PHRASE,
        idempotencyKey: "rel-delivered",
      },
      {
        // An already released nurse buyer_csv_v2 package has no Age column and
        // would be refused today, yet it must still replay unchanged.
        ...releaseDb({
          id: "pkg_delivered",
          leadOrderId: "ord_1",
          clientAccountId: "acct_a",
          contentSha256: "sha",
          rowCount: 1,
          csvContent: nurseV2Package,
          allocationIdsJson: ["alloc_a"],
          leadOrder: { nicheKey: "nurse" },
          spreadsheetDeliveredAt: deliveredAt,
          spreadsheetDeliveredBy: "ops",
          customerReleaseNotifyStatus: null,
        }),
        leadOrder: { findUnique: async () => null },
      } as never
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.idempotentReplay, true);
    assert.equal(result.deliveredAt, deliveredAt.toISOString());
  });

  it("serves historical buyer_csv_v2 package bytes exactly as stored", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    const download = await getBuyerCsvExportDownload("pkg_hist", {
      leadDeliveryExportPackage: {
        findUnique: async () => ({
          id: "pkg_hist",
          clientAccountId: "acct_a",
          contentSha256: "sha-hist",
          rowCount: 1,
          csvContent: nurseV2Package,
          fieldSchemaVersion: "buyer_csv_v2",
          metadataJson: { niche: "nurse" },
          spreadsheetDeliveredAt: new Date("2026-02-01T00:00:00.000Z"),
          leadOrder: {
            orderNumber: "1001",
            clientDisplayName: "Mercy Nurse",
            nicheKey: "nurse",
            statesJson: ["NC"],
          },
        }),
      },
    } as never);
    assert.equal(download.ok, true);
    if (!download.ok) return;
    assert.equal(download.csv, nurseV2Package, "stored package bytes must not be rewritten");
    assert.equal(download.fieldSchemaVersion, "buyer_csv_v2");
    assert.equal(headerOf(download.csv).includes("age"), false);
    assert.equal(countBlankAgeCellsInCsv(download.csv), 0, "no Age column to count");
  });
});
