/**
 * Local Postgres proof for the historical ownership and resale registry.
 * Uses SA360_TEST_DATABASE_URL only (localhost, database name contains "test").
 * Writes registry rows only. Does not stamp inventory.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";

const integrationUrl = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrl);

const SUFFIX = `hors${Date.now().toString(36)}`;
const CLIENT_A = `${SUFFIX}a`;
const CLIENT_B = `${SUFFIX}b`;
const ACTOR = "registry-operator";
const DETAILS = "counsel reviewed executed agreement";
const VERIFIED = new Date("2026-07-15T00:00:00.000Z");
const EFFECTIVE = new Date("2026-01-01T00:00:00.000Z");
const EXPIRES = new Date("2026-12-31T00:00:00.000Z");
const EVAL = new Date("2026-10-19T12:00:00.000Z");
const BEFORE_EFFECTIVE = new Date("2025-12-31T23:59:59.000Z");
const AT_EXPIRY = new Date("2026-12-31T00:00:00.000Z");
const AFTER_EXPIRY = new Date("2026-12-31T00:00:01.000Z");

type Ownership = {
  decision: string;
  reason: string;
  origin_client_account_id: string | null;
  lot_status: string;
  import_status: string;
  lot_alias_id: string | null;
  import_alias_id: string | null;
};

type Resale = {
  decision: string;
  reason: string;
  lot_posture: string;
  import_posture: string;
  lot_authorization_id: string | null;
  import_authorization_id: string | null;
};

type InventoryStamp = { items: number; stamped: number; lots: number };

function textOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function expectReject(run: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await run();
  } catch (err) {
    assert.match(textOf(err), pattern);
    return;
  }
  assert.fail(`expected rejection matching ${pattern}`);
}

describe("historical ownership and resale registry", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  let beforeInventory: InventoryStamp;
  let request = 0;

  function requestId(name: string): string {
    request += 1;
    return `${SUFFIX}-${name}-${request}`;
  }

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrl);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$executeRawUnsafe(`SET TIME ZONE 'UTC'`);
    const ready = await db.$queryRaw<Array<{ ok: string | null }>>`
      SELECT to_regclass('public."HistoricalCampaignAlias"')::text AS ok
    `;
    assert.ok(ready[0]?.ok, "apply migration 20261019220000 on the local test database first");
    await cleanup();
    await db.clientAccount.createMany({
      data: [
        { clientAccountId: CLIENT_A, clientDisplayName: "Registry Client A", status: "active" },
        { clientAccountId: CLIENT_B, clientDisplayName: "Registry Client B", status: "active" },
      ],
    });
    beforeInventory = await inventoryStamp();
  });

  after(async () => {
    if (!db) return;
    await cleanup();
    await db.$disconnect();
  });

  async function inventoryStamp(): Promise<InventoryStamp> {
    const rows = await db.$queryRaw<InventoryStamp[]>`
      SELECT
        (SELECT COUNT(*) FROM "LeadInventoryItem")::int AS items,
        (SELECT COUNT(*) FROM "LeadInventoryItem" WHERE "originClientAccountId" IS NOT NULL)::int AS stamped,
        (SELECT COUNT(*) FROM "InventoryLot")::int AS lots
    `;
    return rows[0];
  }

  async function setRegistryTriggers(enabled: boolean): Promise<void> {
    const verb = enabled ? "ENABLE" : "DISABLE";
    for (const table of [
      "HistoricalCampaignAliasEvent",
      "HistoricalCampaignAlias",
      "HistoricalResaleAuthorizationEvent",
      "HistoricalResaleAuthorization",
    ]) {
      await db.$executeRawUnsafe(`ALTER TABLE "${table}" ${verb} TRIGGER USER`);
    }
  }

  async function cleanup(): Promise<void> {
    await setRegistryTriggers(false);
    try {
      await db.historicalCampaignAliasEvent.deleteMany({
        where: { requestId: { startsWith: SUFFIX } },
      });
      await db.historicalCampaignAlias.deleteMany({
        where: { scopeKey: { startsWith: SUFFIX } },
      });
      await db.historicalResaleAuthorizationEvent.deleteMany({
        where: { requestId: { startsWith: SUFFIX } },
      });
      await db.historicalResaleAuthorization.deleteMany({
        where: { scopeKey: { startsWith: SUFFIX } },
      });
      await db.clientAccount.deleteMany({
        where: { clientAccountId: { in: [CLIENT_A, CLIENT_B] } },
      });
    } finally {
      await setRegistryTriggers(true);
    }
  }

  async function ownership(
    lot: string | null,
    importKey: string | null,
    label: string
  ): Promise<Ownership> {
    const rows = await db.$queryRaw<Ownership[]>`
      SELECT * FROM historical_campaign_ownership_decision(${lot}, ${importKey}, ${label})
    `;
    assert.equal(rows.length, 1);
    return rows[0];
  }

  async function resale(
    lot: string | null,
    importKey: string | null,
    at: Date | null
  ): Promise<Resale> {
    const rows = await db.$queryRaw<Resale[]>`
      SELECT * FROM historical_resale_authorization_decision(${lot}, ${importKey}, ${at}::timestamptz)
    `;
    assert.equal(rows.length, 1);
    return rows[0];
  }

  async function recordAlias(input: {
    scopeType: "inventory_lot" | "import_request";
    scopeKey: string;
    label: string;
    displayLabel?: string;
  }): Promise<string> {
    return db.$transaction(async (tx) => {
      const alias = await tx.historicalCampaignAlias.create({
        data: {
          scopeType: input.scopeType,
          scopeKey: input.scopeKey,
          normalizedLabel: input.label,
          displayLabel: input.displayLabel ?? input.label,
          status: "unassigned",
        },
      });
      await tx.historicalCampaignAliasEvent.create({
        data: {
          aliasId: alias.id,
          sequence: 99,
          action: "recorded",
          actor: ACTOR,
          requestId: requestId("recorded"),
        },
      });
      return alias.id;
    });
  }

  async function suggestAlias(id: string, clientId: string): Promise<void> {
    await db.$transaction(async (tx) => {
      await tx.historicalCampaignAlias.update({
        where: { id },
        data: { status: "suggested" },
      });
      await tx.historicalCampaignAliasEvent.create({
        data: {
          aliasId: id,
          action: "suggested",
          nextOriginClientAccountId: clientId,
          actor: ACTOR,
          note: "name overlap only",
          requestId: requestId("suggested"),
        },
      });
    });
  }

  async function confirmAlias(id: string, clientId: string): Promise<void> {
    await db.$transaction(async (tx) => {
      await tx.historicalCampaignAlias.update({
        where: { id },
        data: { status: "confirmed", originClientAccountId: clientId },
      });
      await tx.historicalCampaignAliasEvent.create({
        data: {
          aliasId: id,
          action: "confirmed",
          nextOriginClientAccountId: clientId,
          actor: ACTOR,
          requestId: requestId("confirmed"),
        },
      });
    });
  }

  async function confirmDirect(input: {
    scopeType: "inventory_lot" | "import_request";
    scopeKey: string;
    label: string;
    clientId: string;
    displayLabel?: string;
  }): Promise<string> {
    return db.$transaction(async (tx) => {
      const alias = await tx.historicalCampaignAlias.create({
        data: {
          scopeType: input.scopeType,
          scopeKey: input.scopeKey,
          normalizedLabel: input.label,
          displayLabel: input.displayLabel ?? input.label,
          status: "confirmed",
          originClientAccountId: input.clientId,
        },
      });
      await tx.historicalCampaignAliasEvent.create({
        data: {
          aliasId: alias.id,
          action: "confirmed",
          nextOriginClientAccountId: input.clientId,
          actor: ACTOR,
          requestId: requestId("direct"),
        },
      });
      return alias.id;
    });
  }

  async function proposeResale(input: {
    scopeType: "inventory_lot" | "import_request";
    scopeKey: string;
    operatorNote?: string | null;
  }): Promise<string> {
    const note = input.operatorNote ?? null;
    return db.$transaction(async (tx) => {
      const row = await tx.historicalResaleAuthorization.create({
        data: {
          scopeType: input.scopeType,
          scopeKey: input.scopeKey,
          status: "proposed",
          operatorNote: note,
        },
      });
      await tx.historicalResaleAuthorizationEvent.create({
        data: {
          authorizationId: row.id,
          action: "proposed",
          nextStatus: "proposed",
          actor: ACTOR,
          operatorNote: note,
          requestId: requestId("propose"),
        },
      });
      return row.id;
    });
  }

  async function confirmResale(input: {
    id: string;
    evidenceType: "purchase_agreement" | "license" | "acquisition_record";
    evidenceReference: string;
    operatorNote?: string | null;
    effectiveAt?: Date;
    expiresAt?: Date | null;
  }): Promise<void> {
    const note = input.operatorNote === undefined ? null : input.operatorNote;
    const effectiveAt = input.effectiveAt ?? EFFECTIVE;
    const expiresAt = input.expiresAt === undefined ? EXPIRES : input.expiresAt;
    await db.$transaction(async (tx) => {
      await tx.historicalResaleAuthorization.update({
        where: { id: input.id },
        data: {
          status: "confirmed",
          evidenceType: input.evidenceType,
          evidenceReference: input.evidenceReference,
          verificationDetails: DETAILS,
          operatorNote: note,
          authorizedOperator: ACTOR,
          verifiedAt: VERIFIED,
          effectiveAt,
          expiresAt,
        },
      });
      await tx.historicalResaleAuthorizationEvent.create({
        data: {
          authorizationId: input.id,
          action: "confirmed",
          previousStatus: "proposed",
          nextStatus: "confirmed",
          actor: ACTOR,
          evidenceType: input.evidenceType,
          evidenceReference: input.evidenceReference,
          verificationDetails: DETAILS,
          operatorNote: note,
          authorizedOperator: ACTOR,
          verifiedAt: VERIFIED,
          effectiveAt,
          expiresAt,
          requestId: requestId("resale-confirm"),
        },
      });
    });
  }

  it("enforces foreign keys, uniqueness, indexes, and append-only history", async () => {
    const label = `July Vet ${SUFFIX}`;
    const lot = `${SUFFIX}-lot-base`;
    const aliasId = await recordAlias({ scopeType: "inventory_lot", scopeKey: lot, label });
    const recorded = await db.historicalCampaignAliasEvent.findFirstOrThrow({
      where: { aliasId, action: "recorded" },
    });
    assert.equal(recorded.sequence, 1);
    assert.equal(recorded.previousOriginClientAccountId, null);
    assert.equal(recorded.nextOriginClientAccountId, null);

    await expectReject(
      () =>
        db.historicalCampaignAlias.create({
          data: {
            scopeType: "inventory_lot",
            scopeKey: `${SUFFIX}-orphan`,
            normalizedLabel: label,
            displayLabel: label,
            status: "unassigned",
          },
        }),
      /no append-only event|23001/
    );

    await expectReject(
      () =>
        confirmDirect({
          scopeType: "inventory_lot",
          scopeKey: `${SUFFIX}-missing-client`,
          label,
          clientId: `${SUFFIX}-missing`,
        }),
      /23503|Foreign key|foreign key/
    );

    await suggestAlias(aliasId, CLIENT_A);
    await expectReject(() => confirmAlias(aliasId, CLIENT_B), /suggested client|23001/);
    await confirmAlias(aliasId, CLIENT_A);

    const confirmedEvents = await db.historicalCampaignAliasEvent.findMany({
      where: { aliasId },
      orderBy: { sequence: "asc" },
    });
    assert.deepEqual(
      confirmedEvents.map((event) => event.action),
      ["recorded", "suggested", "confirmed"]
    );
    assert.equal(confirmedEvents[1]?.nextOriginClientAccountId, CLIENT_A);
    assert.equal(confirmedEvents[0]?.nextOriginClientAccountId, null);

    await db.$transaction(async (tx) => {
      await tx.historicalCampaignAlias.update({
        where: { id: aliasId },
        data: { originClientAccountId: CLIENT_B },
      });
      await tx.historicalCampaignAliasEvent.create({
        data: {
          aliasId,
          action: "reassigned",
          previousOriginClientAccountId: CLIENT_A,
          nextOriginClientAccountId: CLIENT_B,
          actor: ACTOR,
          requestId: requestId("reassign"),
        },
      });
    });

    const afterReassign = await db.historicalCampaignAliasEvent.findMany({
      where: { aliasId },
      orderBy: { sequence: "asc" },
    });
    assert.equal(afterReassign.length, 4);
    assert.equal(afterReassign[2]?.action, "confirmed");
    assert.equal(afterReassign[2]?.nextOriginClientAccountId, CLIENT_A);
    assert.equal(afterReassign[3]?.action, "reassigned");
    assert.equal(afterReassign[3]?.previousOriginClientAccountId, CLIENT_A);
    assert.equal(afterReassign[3]?.nextOriginClientAccountId, CLIENT_B);
    assert.equal(afterReassign[0]?.id, recorded.id);
    assert.equal(afterReassign[0]?.actor, ACTOR);

    await expectReject(
      () =>
        db.historicalCampaignAliasEvent.update({
          where: { id: recorded.id },
          data: { actor: "rewritten-actor" },
        }),
      /append-only|23001/
    );
    await expectReject(
      () => db.historicalCampaignAliasEvent.delete({ where: { id: recorded.id } }),
      /append-only|23001/
    );
    const still = await db.historicalCampaignAliasEvent.findUniqueOrThrow({ where: { id: recorded.id } });
    assert.equal(still.actor, ACTOR);
    assert.equal(still.nextOriginClientAccountId, null);

    await expectReject(
      () =>
        db.historicalCampaignAliasEvent.create({
          data: {
            aliasId,
            action: "recorded",
            actor: ACTOR,
            requestId: recorded.requestId,
          },
        }),
      /23505|Unique constraint|unique constraint/
    );
    assert.equal(await db.historicalCampaignAliasEvent.count({ where: { aliasId } }), 4);

    await expectReject(
      () =>
        db.historicalCampaignAlias.update({
          where: { id: aliasId },
          data: { normalizedLabel: `Other ${SUFFIX}` },
        }),
      /immutable|23001/
    );

    await expectReject(
      () => db.clientAccount.delete({ where: { clientAccountId: CLIENT_A } }),
      /23503|Foreign key|foreign key|retained|23001/
    );

    const indexes = await db.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'HistoricalCampaignAlias_scope_label_key',
          'HistAliasEvent_request_id_key',
          'HistoricalResaleAuthorization_one_live_scope_key',
          'HistoricalResaleAuthEvent_request_id_key'
        )
    `;
    assert.equal(indexes.length, 4);
    const live = indexes.find((row) => row.indexdef.includes("one_live_scope_key"));
    assert.match(live?.indexdef ?? "", /UNIQUE/);
    assert.match(live?.indexdef ?? "", /proposed/);
    assert.match(live?.indexdef ?? "", /confirmed/);

    const fks = await db.$queryRaw<Array<{ conname: string }>>`
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE con.contype = 'f'
        AND rel.relname IN (
          'HistoricalCampaignAlias',
          'HistoricalCampaignAliasEvent',
          'HistoricalResaleAuthorizationEvent'
        )
    `;
    const fkNames = fks.map((row) => row.conname);
    for (const name of [
      "HistoricalCampaignAlias_originClientAccountId_fkey",
      "HistAliasEvent_prev_origin_fkey",
      "HistAliasEvent_next_origin_fkey",
      "HistoricalCampaignAliasEvent_aliasId_fkey",
      "HistoricalResaleAuthorizationEvent_authorizationId_fkey",
    ]) {
      assert.equal(fkNames.includes(name), true, name);
    }

    const originColumns = await db.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'LeadInventoryItem'
        AND column_name ILIKE '%origin%'
    `;
    assert.deepEqual(
      originColumns.map((row) => row.column_name),
      ["originClientAccountId"]
    );
  });

  it("keeps suggestions unconfirmed and fails closed on overlap", async () => {
    const label = `July Trucker ${SUFFIX}`;
    const lot = `${SUFFIX}-lot-overlap`;
    const importKey = `${SUFFIX}-import-overlap`;
    const suggestedId = await recordAlias({
      scopeType: "inventory_lot",
      scopeKey: lot,
      label,
      displayLabel: `  July   Trucker   ${SUFFIX}  `,
    });
    await suggestAlias(suggestedId, CLIENT_A);
    const suggested = await ownership(lot, null, `  July   Trucker   ${SUFFIX}  `);
    assert.equal(suggested.decision, "not_eligible");
    assert.equal(suggested.reason, "suggestion_is_not_ownership");
    assert.equal(suggested.origin_client_account_id, null);
    assert.equal(suggested.lot_status, "suggested");
    const row = await db.historicalCampaignAlias.findUniqueOrThrow({ where: { id: suggestedId } });
    assert.equal(row.originClientAccountId, null);
    assert.equal(row.normalizedLabel, label);

    await confirmAlias(suggestedId, CLIENT_A);
    const lotOnly = await ownership(lot, "(none)", label);
    assert.equal(lotOnly.decision, "eligible");
    assert.equal(lotOnly.reason, "eligible_lot_only");
    assert.equal(lotOnly.origin_client_account_id, CLIENT_A);

    const importSuggested = await recordAlias({
      scopeType: "import_request",
      scopeKey: importKey,
      label,
    });
    await suggestAlias(importSuggested, CLIENT_B);
    const ambiguous = await ownership(lot, importKey, label);
    assert.equal(ambiguous.decision, "not_eligible");
    assert.equal(ambiguous.reason, "fail_closed_ambiguous");
    assert.equal(ambiguous.origin_client_account_id, null);

    await db.$transaction(async (tx) => {
      await tx.historicalCampaignAlias.update({
        where: { id: importSuggested },
        data: { status: "conflicted" },
      });
      await tx.historicalCampaignAliasEvent.create({
        data: {
          aliasId: importSuggested,
          action: "conflicted",
          previousOriginClientAccountId: null,
          nextOriginClientAccountId: null,
          actor: ACTOR,
          requestId: requestId("conflict"),
        },
      });
    });
    const conflicted = await ownership(lot, importKey, label);
    assert.equal(conflicted.decision, "not_eligible");
    assert.equal(conflicted.reason, "fail_closed_conflicted");
    assert.equal(conflicted.origin_client_account_id, null);

    const otherLabel = `July Other ${SUFFIX}`;
    await confirmDirect({
      scopeType: "import_request",
      scopeKey: `${SUFFIX}-import-agree`,
      label: otherLabel,
      clientId: CLIENT_A,
    });
    await confirmDirect({
      scopeType: "inventory_lot",
      scopeKey: `${SUFFIX}-lot-agree`,
      label: otherLabel,
      clientId: CLIENT_A,
    });
    const agreed = await ownership(`${SUFFIX}-lot-agree`, `${SUFFIX}-import-agree`, otherLabel);
    assert.equal(agreed.decision, "eligible");
    assert.equal(agreed.reason, "eligible_scopes_agree");
    assert.equal(agreed.origin_client_account_id, CLIENT_A);

    await confirmDirect({
      scopeType: "inventory_lot",
      scopeKey: `${SUFFIX}-lot-clash`,
      label: otherLabel,
      clientId: CLIENT_A,
    });
    await confirmDirect({
      scopeType: "import_request",
      scopeKey: `${SUFFIX}-import-clash`,
      label: otherLabel,
      clientId: CLIENT_B,
    });
    const clash = await ownership(`${SUFFIX}-lot-clash`, `${SUFFIX}-import-clash`, otherLabel);
    assert.equal(clash.decision, "not_eligible");
    assert.equal(clash.reason, "fail_closed_conflicting_clients");
    assert.equal(clash.origin_client_account_id, null);

    const retiredLabel = `July Retired ${SUFFIX}`;
    const retiredId = await confirmDirect({
      scopeType: "inventory_lot",
      scopeKey: `${SUFFIX}-lot-retired`,
      label: retiredLabel,
      clientId: CLIENT_A,
    });
    await db.$transaction(async (tx) => {
      await tx.historicalCampaignAlias.update({
        where: { id: retiredId },
        data: { status: "retired" },
      });
      await tx.historicalCampaignAliasEvent.create({
        data: {
          aliasId: retiredId,
          action: "retired",
          previousOriginClientAccountId: CLIENT_A,
          nextOriginClientAccountId: CLIENT_A,
          actor: ACTOR,
          requestId: requestId("retire"),
        },
      });
    });
    await confirmDirect({
      scopeType: "import_request",
      scopeKey: `${SUFFIX}-import-after-retire`,
      label: retiredLabel,
      clientId: CLIENT_B,
    });
    const afterRetire = await ownership(
      `${SUFFIX}-lot-retired`,
      `${SUFFIX}-import-after-retire`,
      retiredLabel
    );
    assert.equal(afterRetire.decision, "eligible");
    assert.equal(afterRetire.reason, "eligible_import_request_only");
    assert.equal(afterRetire.origin_client_account_id, CLIENT_B);
    assert.equal(afterRetire.lot_status, "retired");

    const missing = await ownership(null, "(blank)", label);
    assert.equal(missing.reason, "fail_closed_missing_scope");
    const blankLabel = await ownership(lot, null, "   ");
    assert.equal(blankLabel.reason, "fail_closed_missing_label");

    await expectReject(
      () =>
        recordAlias({
          scopeType: "inventory_lot",
          scopeKey: "(none)",
          label,
        }),
      /23514|scope_key/
    );
    await expectReject(
      () =>
        db.$transaction(async (tx) => {
          const alias = await tx.historicalCampaignAlias.create({
            data: {
              scopeType: "inventory_lot",
              scopeKey: `${SUFFIX}-bad-display`,
              normalizedLabel: label,
              displayLabel: `Workbook ${SUFFIX}`,
              status: "unassigned",
            },
          });
          await tx.historicalCampaignAliasEvent.create({
            data: {
              aliasId: alias.id,
              action: "recorded",
              actor: ACTOR,
              requestId: requestId("bad-display"),
            },
          });
        }),
      /23514|label_chk/
    );

    const lower = await confirmDirect({
      scopeType: "inventory_lot",
      scopeKey: `${SUFFIX}-lot-case`,
      label: `July Case ${SUFFIX}`,
      clientId: CLIENT_A,
    });
    const upperId = await confirmDirect({
      scopeType: "inventory_lot",
      scopeKey: `${SUFFIX}-lot-case`,
      label: `july case ${SUFFIX}`,
      clientId: CLIENT_B,
    });
    assert.notEqual(lower, upperId);
  });

  it("requires resale evidence and keeps revoked or expired grants ineligible", async () => {
    const lot = `${SUFFIX}-resale-lot`;
    const importKey = `${SUFFIX}-resale-import`;
    const noteOnly = await proposeResale({
      scopeType: "inventory_lot",
      scopeKey: lot,
      operatorNote: "Purchased from the July workbook",
    });
    const proposed = await resale(lot, null, EVAL);
    assert.equal(proposed.decision, "not_eligible");
    assert.equal(proposed.reason, "proposed_not_granted");
    assert.equal(proposed.lot_authorization_id, null);

    await expectReject(
      () =>
        db.$transaction(async (tx) => {
          const row = await tx.historicalResaleAuthorization.create({
            data: {
              scopeType: "inventory_lot",
              scopeKey: `${SUFFIX}-note-only`,
              status: "confirmed",
              operatorNote: "Purchased from the July workbook",
              authorizedOperator: ACTOR,
              verifiedAt: VERIFIED,
              effectiveAt: EFFECTIVE,
            },
          });
          await tx.historicalResaleAuthorizationEvent.create({
            data: {
              authorizationId: row.id,
              action: "proposed",
              nextStatus: "proposed",
              actor: ACTOR,
              requestId: requestId("note-only"),
            },
          });
        }),
      /23514|status_chk|evidence/
    );

    await expectReject(
      () =>
        confirmResale({
          id: noteOnly,
          evidenceType: "purchase_agreement",
          evidenceReference: "exclusive",
        }),
      /23514|evidence/
    );
    await expectReject(
      () =>
        confirmResale({
          id: noteOnly,
          evidenceType: "license",
          evidenceReference: "agreement:rec-1",
        }),
      /23514|evidence/
    );

    await confirmResale({
      id: noteOnly,
      evidenceType: "purchase_agreement",
      evidenceReference: `agreement:${SUFFIX}-rec`,
      operatorNote: "Purchased from the July workbook",
    });
    const granted = await resale(lot, null, EVAL);
    assert.equal(granted.decision, "eligible");
    assert.equal(granted.reason, "eligible_lot_grant");
    assert.equal(granted.lot_authorization_id, noteOnly);
    assert.equal(granted.import_authorization_id, null);

    const atStart = await resale(lot, null, EFFECTIVE);
    assert.equal(atStart.reason, "eligible_lot_grant");
    const tooEarly = await resale(lot, null, BEFORE_EFFECTIVE);
    assert.equal(tooEarly.decision, "not_eligible");
    assert.equal(tooEarly.reason, "not_yet_effective");
    assert.equal(tooEarly.lot_authorization_id, null);
    const atExpiry = await resale(lot, null, AT_EXPIRY);
    assert.equal(atExpiry.reason, "expired");
    assert.equal(atExpiry.lot_authorization_id, null);
    const afterExpiry = await resale(lot, null, AFTER_EXPIRY);
    assert.equal(afterExpiry.reason, "expired");

    await expectReject(
      () =>
        proposeResale({
          scopeType: "inventory_lot",
          scopeKey: lot,
        }),
      /23505|Unique constraint|unique constraint|one_live/
    );

    const importId = await proposeResale({
      scopeType: "import_request",
      scopeKey: importKey,
    });
    const overlapProposal = await resale(lot, importKey, EVAL);
    assert.equal(overlapProposal.decision, "not_eligible");
    assert.equal(overlapProposal.reason, "fail_closed_ambiguous");
    assert.equal(overlapProposal.lot_authorization_id, null);
    assert.equal(overlapProposal.import_authorization_id, null);

    await confirmResale({
      id: importId,
      evidenceType: "license",
      evidenceReference: `license:${SUFFIX}-lic`,
    });
    const both = await resale(lot, importKey, EVAL);
    assert.equal(both.decision, "eligible");
    assert.equal(both.reason, "eligible_scopes_agree");
    assert.equal(both.lot_authorization_id, noteOnly);
    assert.equal(both.import_authorization_id, importId);

    await expectReject(
      () =>
        db.historicalResaleAuthorization.update({
          where: { id: noteOnly },
          data: { operatorNote: "rewritten after confirmation" },
        }),
      /immutable|23001/
    );

    const revokedAt = new Date("2026-10-01T00:00:00.000Z");
    await db.$transaction(async (tx) => {
      await tx.historicalResaleAuthorization.update({
        where: { id: noteOnly },
        data: {
          status: "revoked",
          revokedAt,
          revocationReason: "agreement rescinded",
        },
      });
      await tx.historicalResaleAuthorizationEvent.create({
        data: {
          authorizationId: noteOnly,
          action: "revoked",
          previousStatus: "confirmed",
          nextStatus: "revoked",
          actor: "registry-revoker",
          evidenceType: "purchase_agreement",
          evidenceReference: `agreement:${SUFFIX}-rec`,
          verificationDetails: DETAILS,
          operatorNote: "Purchased from the July workbook",
          authorizedOperator: ACTOR,
          verifiedAt: VERIFIED,
          effectiveAt: EFFECTIVE,
          expiresAt: EXPIRES,
          revokedAt,
          revocationReason: "agreement rescinded",
          requestId: requestId("revoke"),
        },
      });
    });
    const revokedEvents = await db.historicalResaleAuthorizationEvent.findMany({
      where: { authorizationId: noteOnly },
      orderBy: { sequence: "asc" },
    });
    assert.deepEqual(
      revokedEvents.map((event) => event.action),
      ["proposed", "confirmed", "revoked"]
    );
    assert.equal(revokedEvents[1]?.evidenceReference, `agreement:${SUFFIX}-rec`);
    const revokedDecision = await resale(lot, importKey, EVAL);
    assert.equal(revokedDecision.decision, "eligible");
    assert.equal(revokedDecision.reason, "eligible_import_request_grant");
    assert.equal(revokedDecision.lot_authorization_id, null);
    assert.equal(revokedDecision.import_authorization_id, importId);

    const replacement = await proposeResale({
      scopeType: "inventory_lot",
      scopeKey: lot,
    });
    assert.notEqual(replacement, noteOnly);
    const replacementDecision = await resale(lot, null, EVAL);
    assert.equal(replacementDecision.reason, "proposed_not_granted");

    await db.$transaction(async (tx) => {
      await tx.historicalResaleAuthorization.update({
        where: { id: importId },
        data: {
          status: "revoked",
          revokedAt,
          revocationReason: "license withdrawn",
        },
      });
      await tx.historicalResaleAuthorizationEvent.create({
        data: {
          authorizationId: importId,
          action: "revoked",
          previousStatus: "confirmed",
          nextStatus: "revoked",
          actor: "registry-revoker",
          evidenceType: "license",
          evidenceReference: `license:${SUFFIX}-lic`,
          verificationDetails: DETAILS,
          authorizedOperator: ACTOR,
          verifiedAt: VERIFIED,
          effectiveAt: EFFECTIVE,
          expiresAt: EXPIRES,
          revokedAt,
          revocationReason: "license withdrawn",
          requestId: requestId("revoke-import"),
        },
      });
    });
    await db.$transaction(async (tx) => {
      await tx.historicalResaleAuthorization.update({
        where: { id: replacement },
        data: {
          status: "revoked",
          revokedAt,
          revocationReason: "proposal withdrawn",
        },
      });
      await tx.historicalResaleAuthorizationEvent.create({
        data: {
          authorizationId: replacement,
          action: "revoked",
          previousStatus: "proposed",
          nextStatus: "revoked",
          actor: ACTOR,
          revokedAt,
          revocationReason: "proposal withdrawn",
          requestId: requestId("revoke-proposal"),
        },
      });
    });
    const onlyRevoked = await resale(lot, importKey, EVAL);
    assert.equal(onlyRevoked.decision, "not_eligible");
    assert.equal(onlyRevoked.reason, "revoked_not_eligible");
    assert.equal(onlyRevoked.lot_authorization_id, null);
    assert.equal(onlyRevoked.import_authorization_id, null);

    const none = await resale(`${SUFFIX}-empty-lot`, `${SUFFIX}-empty-import`, EVAL);
    assert.equal(none.reason, "no_grant");
    const noClock = await resale(lot, null, null);
    assert.equal(noClock.reason, "fail_closed_missing_evaluated_at");
  });

  it("fails closed when unresolved resale coverage overlaps another scope", async () => {
    const expiredLot = `${SUFFIX}-expired-lot`;
    const expiredImport = `${SUFFIX}-expired-import`;
    const expiredId = await proposeResale({ scopeType: "inventory_lot", scopeKey: expiredLot });
    await confirmResale({
      id: expiredId,
      evidenceType: "purchase_agreement",
      evidenceReference: `agreement:${SUFFIX}-expired`,
      expiresAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    await proposeResale({ scopeType: "import_request", scopeKey: expiredImport });
    const expiredOverlap = await resale(expiredLot, expiredImport, EVAL);
    assert.equal(expiredOverlap.decision, "not_eligible");
    assert.equal(expiredOverlap.reason, "fail_closed_ambiguous");
    assert.equal(expiredOverlap.lot_posture, "expired");
    assert.equal(expiredOverlap.import_posture, "proposed");
    assert.equal(expiredOverlap.lot_authorization_id, null);
    assert.equal(expiredOverlap.import_authorization_id, null);

    const liveLot = `${SUFFIX}-live-lot`;
    const futureImport = `${SUFFIX}-future-import`;
    const liveId = await proposeResale({ scopeType: "inventory_lot", scopeKey: liveLot });
    await confirmResale({
      id: liveId,
      evidenceType: "acquisition_record",
      evidenceReference: `acquisition:${SUFFIX}-live`,
    });
    const futureId = await proposeResale({ scopeType: "import_request", scopeKey: futureImport });
    await confirmResale({
      id: futureId,
      evidenceType: "license",
      evidenceReference: `license:${SUFFIX}-future`,
      effectiveAt: new Date("2027-01-01T00:00:00.000Z"),
      expiresAt: null,
    });
    const futureOverlap = await resale(liveLot, futureImport, EVAL);
    assert.equal(futureOverlap.decision, "not_eligible");
    assert.equal(futureOverlap.reason, "fail_closed_ambiguous");
    assert.equal(futureOverlap.lot_posture, "granted");
    assert.equal(futureOverlap.import_posture, "not_yet_effective");
    assert.equal(futureOverlap.lot_authorization_id, null);
    assert.equal(futureOverlap.import_authorization_id, null);
  });

  it("keeps ownership and resale independent of inventory stamps", async () => {
    const label = `July Independent ${SUFFIX}`;
    const lot = `${SUFFIX}-independent-lot`;
    const aliasId = await confirmDirect({
      scopeType: "inventory_lot",
      scopeKey: lot,
      label,
      clientId: CLIENT_A,
    });
    const owned = await ownership(lot, null, label);
    assert.equal(owned.decision, "eligible");
    const noGrant = await resale(lot, null, EVAL);
    assert.equal(noGrant.reason, "no_grant");
    assert.equal(await db.historicalResaleAuthorization.count({ where: { scopeKey: lot } }), 0);

    const authId = await proposeResale({
      scopeType: "import_request",
      scopeKey: `${SUFFIX}-independent-import`,
    });
    await confirmResale({
      id: authId,
      evidenceType: "acquisition_record",
      evidenceReference: `acquisition:${SUFFIX}-acq`,
    });
    const granted = await resale(null, `${SUFFIX}-independent-import`, EVAL);
    assert.equal(granted.reason, "eligible_import_request_grant");
    const stillUnowned = await ownership(null, `${SUFFIX}-independent-import`, label);
    assert.equal(stillUnowned.reason, "no_coverage");
    const alias = await db.historicalCampaignAlias.findUniqueOrThrow({ where: { id: aliasId } });
    assert.equal(alias.originClientAccountId, CLIENT_A);

    const defs = await db.$queryRaw<Array<{ name: string; def: string; security_definer: boolean }>>`
      SELECT
        p.proname AS name,
        pg_get_functiondef(p.oid) AS def,
        p.prosecdef AS security_definer
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'historical_campaign_ownership_decision',
          'historical_resale_authorization_decision',
          'historical_resale_posture'
        )
    `;
    assert.equal(defs.length, 3);
    for (const fn of defs) {
      assert.equal(fn.security_definer, false, fn.name);
      assert.equal(fn.def.includes("LeadInventoryItem"), false, fn.name);
      assert.equal(fn.def.includes("InventoryLot"), false, fn.name);
      assert.equal(fn.def.includes("exclusivityMode"), false, fn.name);
      assert.equal(fn.def.includes("acquisitionCost"), false, fn.name);
      assert.equal(fn.def.includes("usedBy"), false, fn.name);
      assert.equal(fn.def.includes("campaignName"), false, fn.name);
    }
    const ownershipDef = defs.find((fn) => fn.name === "historical_campaign_ownership_decision");
    assert.equal(ownershipDef?.def.includes("HistoricalResaleAuthorization"), false);
    const resaleDef = defs.find((fn) => fn.name === "historical_resale_authorization_decision");
    const postureDef = defs.find((fn) => fn.name === "historical_resale_posture");
    assert.equal(resaleDef?.def.includes("operatorNote"), false);
    assert.equal(postureDef?.def.includes("operatorNote"), false);
    assert.equal(resaleDef?.def.includes("HistoricalCampaignAlias"), false);

    const afterInventory = await inventoryStamp();
    assert.deepEqual(afterInventory, beforeInventory);
  });
});
