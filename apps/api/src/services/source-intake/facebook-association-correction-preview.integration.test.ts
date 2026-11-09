import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, type PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { facebookFormProviderFunnelId } from "./facebook-form-association.js";
import { buildFacebookEventUuid, buildFacebookLeadUid } from "./facebook-lead-normalizer.js";
import {
  PREVIEW_STATEMENT_TIMEOUT_MS,
  PREVIEW_TRANSACTION_TIMEOUT_MS,
  loadFacebookAssociationCorrectionPreview,
  withReadOnlyRepeatableRead,
} from "./facebook-association-correction-preview.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const CONFIRMED_AT = new Date("2026-10-27T14:25:02.000Z");

function uniqueStamp(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

function facebookId(marker: string, stamp: string): string {
  return `${marker}${stamp}`.slice(0, 16);
}

describe("Facebook association correction preview", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const eventIds: string[] = [];
  const clientIds: string[] = [];
  const funnelIds: string[] = [];

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    db = prisma;
    await db.$queryRaw`SELECT 1`;
  });

  after(async () => {
    if (eventIds.length > 0) {
      await db.fulfillmentOutbox.deleteMany({ where: { sourceLeadEventId: { in: eventIds } } });
      await db.companySheetsDispatchIntent.deleteMany({ where: { sourceLeadEventId: { in: eventIds } } });
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: eventIds } } });
    }
    if (funnelIds.length > 0) await db.sourceFunnel.deleteMany({ where: { id: { in: funnelIds } } });
    if (clientIds.length > 0) {
      await db.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } });
    }
  });

  async function client(stamp: string): Promise<string> {
    const clientAccountId = `corr_prev_${stamp}`;
    clientIds.push(clientAccountId);
    await db.clientAccount.create({
      data: { clientAccountId, clientDisplayName: `Synthetic ${stamp}`, status: "active" },
    });
    return clientAccountId;
  }

  async function funnel(input: { clientAccountId: string; pageId: string; formId: string }) {
    const created = await db.sourceFunnel.create({
      data: {
        provider: "facebook",
        providerFunnelId: facebookFormProviderFunnelId(input.pageId, input.formId),
        associationStatus: "confirmed",
        originClientAccountId: input.clientAccountId,
        firstSeenAt: null,
        lastSeenAt: null,
        createdAt: new Date("2026-10-27T14:25:02.789Z"),
      },
    });
    funnelIds.push(created.id);
    await db.$executeRaw`
      UPDATE "SourceFunnel"
      SET "updatedAt" = ${created.createdAt}
      WHERE id = ${created.id}
    `;
    return db.sourceFunnel.findUniqueOrThrow({ where: { id: created.id } });
  }

  async function event(input: {
    pageId: string;
    formId: string;
    leadId?: string | null;
    uid?: string | null;
    receivedAt?: Date;
    normalizedAt?: Date | null;
    campaignId?: string | null;
    outcome?: string;
    audit?: unknown;
    clientAccountId?: string | null;
    email?: string;
  }) {
    const leadId = input.leadId === undefined ? `lead-${uniqueStamp()}` : input.leadId;
    const created = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "facebook",
        sourceSystem: "meta_lead_ads",
        sourceType: "lead_form",
        sourceLeadId: leadId,
        sourceLeadUid: input.uid === undefined && leadId ? buildFacebookLeadUid(leadId) : input.uid,
        sourceCampaignId: input.campaignId ?? null,
        clientAccountIdResolved: input.clientAccountId ?? null,
        status: "normalized",
        rawPayloadJson: { synthetic: true, email: input.email ?? null },
        normalizedPayloadJson: {
          source: { page_id: input.pageId, form_id: input.formId },
          event: leadId ? { event_uuid: buildFacebookEventUuid(leadId) } : {},
        },
        enrichmentMetadataJson: {
          captureOnly: true,
          captureSettled: true,
          association: { outcome: input.outcome ?? "unassociated", pageId: input.pageId, formId: input.formId },
          delivery: { thisRequestAttempted: false, historicalOutcome: "not_recorded" },
          associationAudit: input.audit ?? [],
        },
        receivedAt: input.receivedAt ?? new Date("2026-10-20T12:00:00.000Z"),
        normalizedAt: input.normalizedAt === undefined ? new Date("2026-10-20T12:00:00.000Z") : input.normalizedAt,
      },
    });
    eventIds.push(created.id);
    return created;
  }

  function preview(input: { funnelId: string; pageId: string; formId: string; origin: string; limit?: number; offset?: number; decision?: "all" | "eligible" | "blocked" | "excluded"; allow?: boolean }) {
    return loadFacebookAssociationCorrectionPreview({
      sourceFunnelId: input.funnelId,
      pageId: input.pageId,
      formId: input.formId,
      originClientAccountId: input.origin,
      confirmedAt: CONFIRMED_AT,
      limit: input.limit ?? 25,
      offset: input.offset ?? 0,
      decision: input.decision ?? "all",
      includeAllowList: input.allow ?? true,
    });
  }

  it("marks a historical capture eligible and does not write or echo the payload", async () => {
    const stamp = uniqueStamp();
    const pageId = facebookId("91", stamp);
    const formId = facebookId("81", stamp);
    const origin = await client(stamp);
    const sourceFunnel = await funnel({ clientAccountId: origin, pageId, formId });
    const email = `synthetic-${stamp}@example.test`;
    const row = await event({ pageId, formId, email });
    const before = {
      events: await db.sourceLeadEvent.count(),
      funnels: await db.sourceFunnel.count(),
      outbox: await db.fulfillmentOutbox.count(),
      audits: await db.clientOnboardingV2AuditEvent.count(),
      updatedAt: row.updatedAt.toISOString(),
    };

    const result = await preview({ funnelId: sourceFunnel.id, pageId, formId, origin });
    const item = result.events.items.find((entry) => entry.sourceEventId === row.id);
    assert.equal(item?.decision, "eligible");
    assert.equal(result.preview.eligibleCount, 1);
    assert.deepEqual(result.allowList, [row.id]);
    assert.equal(result.writesPerformed, false);
    assert.equal(result.correctionEnabled, false);
    assert.equal(result.preview.authorizesExecution, false);
    assert.equal(result.cohort.provenance.provesHistoricalOwnership, false);
    assert.equal(result.cohort.confirmedAt, "2026-10-27T14:25:02.000Z");
    assert.equal(result.cohort.funnelTouchedAfterConfirmation, true);
    assert.equal(JSON.stringify(result).includes(email), false);
    assert.equal(JSON.stringify(result).includes("rawPayloadJson"), false);

    assert.equal(await db.sourceLeadEvent.count(), before.events);
    assert.equal(await db.sourceFunnel.count(), before.funnels);
    assert.equal(await db.fulfillmentOutbox.count(), before.outbox);
    assert.equal(await db.clientOnboardingV2AuditEvent.count(), before.audits);
    const after = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(after.updatedAt.toISOString(), before.updatedAt);
    assert.equal(after.clientAccountIdResolved, null);
  });

  it("blocks a fulfillment outbox row and a sheets intent without inferring safety from a null client", async () => {
    const stamp = uniqueStamp();
    const pageId = facebookId("92", stamp);
    const formId = facebookId("82", stamp);
    const origin = await client(stamp);
    const sourceFunnel = await funnel({ clientAccountId: origin, pageId, formId });
    const outboxEvent = await event({ pageId, formId });
    const sheetsEvent = await event({ pageId, formId });
    await db.fulfillmentOutbox.create({
      data: { idempotencyKey: `outbox-${stamp}`, sourceLeadEventId: outboxEvent.id, workType: "synthetic" },
    });
    await db.companySheetsDispatchIntent.create({
      data: {
        idempotencyKey: `sheets-${stamp}`,
        kind: "campaign_lead",
        status: "pending",
        clientAccountId: origin,
        sourceLeadEventId: sheetsEvent.id,
      },
    });

    const result = await preview({ funnelId: sourceFunnel.id, pageId, formId, origin });
    const outbox = result.events.items.find((entry) => entry.sourceEventId === outboxEvent.id);
    const sheets = result.events.items.find((entry) => entry.sourceEventId === sheetsEvent.id);
    assert.equal(outbox?.decision, "blocked");
    assert.ok(outbox?.blockingReasons.includes("fulfillment_relation_present"));
    assert.equal(outbox?.clientAccountIdResolved, null);
    assert.equal(sheets?.decision, "blocked");
    assert.ok(sheets?.blockingReasons.includes("sheets_relation_present"));
    assert.equal(result.allowList.includes(outboxEvent.id), false);
    assert.equal(result.allowList.includes(sheetsEvent.id), false);
  });

  it("excludes a blank identity and blocks campaign, cutoff, reevaluation, duplicates, and a missing uid", async () => {
    const stamp = uniqueStamp();
    const pageId = facebookId("93", stamp);
    const formId = facebookId("83", stamp);
    const origin = await client(stamp);
    const sourceFunnel = await funnel({ clientAccountId: origin, pageId, formId });
    const blank = await event({ pageId, formId, leadId: null, uid: null });
    const campaign = await event({ pageId, formId, campaignId: "1234567890" });
    const late = await event({
      pageId,
      formId,
      receivedAt: CONFIRMED_AT,
      normalizedAt: CONFIRMED_AT,
    });
    const reevaluated = await event({
      pageId,
      formId,
      audit: [{ at: "2026-10-27T14:26:21.392Z", action: "reevaluate_association" }],
    });
    const sharedLead = `shared-${stamp}`;
    const first = await event({ pageId, formId, leadId: sharedLead });
    const second = await event({ pageId, formId, leadId: sharedLead });
    const noUid = await event({ pageId, formId, uid: null });

    const result = await preview({ funnelId: sourceFunnel.id, pageId, formId, origin, limit: 100 });
    const byId = new Map(result.events.items.map((entry) => [entry.sourceEventId, entry]));
    assert.equal(byId.get(blank.id)?.decision, "excluded");
    assert.ok(byId.get(blank.id)?.blockingReasons.includes("identity_less_excluded"));
    assert.ok(byId.get(campaign.id)?.blockingReasons.includes("campaign_scope_present"));
    assert.ok(byId.get(late.id)?.blockingReasons.includes("settled_after_confirmation"));
    assert.ok(byId.get(reevaluated.id)?.blockingReasons.includes("already_reevaluated"));
    assert.ok(byId.get(first.id)?.blockingReasons.includes("duplicate_canonical_identity"));
    assert.ok(byId.get(second.id)?.blockingReasons.includes("duplicate_canonical_identity"));
    assert.ok(byId.get(noUid.id)?.blockingReasons.includes("relation_unverified"));
    assert.equal(result.allowList.includes(blank.id), false);
    assert.equal(result.preview.excludedCount >= 1, true);
  });

  it("returns no eligible ids when the origin does not match and keeps the digest stable across pages", async () => {
    const stamp = uniqueStamp();
    const pageId = facebookId("94", stamp);
    const formId = facebookId("84", stamp);
    const origin = await client(stamp);
    const sourceFunnel = await funnel({ clientAccountId: origin, pageId, formId });
    await assert.rejects(() =>
      db.sourceFunnel.create({
        data: {
          provider: "facebook",
          providerFunnelId: facebookFormProviderFunnelId(pageId, formId),
          associationStatus: "confirmed",
          originClientAccountId: origin,
        },
      })
    );
    const ids = [];
    for (let index = 0; index < 3; index += 1) ids.push((await event({ pageId, formId })).id);

    const mismatch = await preview({ funnelId: sourceFunnel.id, pageId, formId, origin: "someone_else" });
    assert.equal(mismatch.preview.eligibleCount, 0);
    assert.deepEqual(mismatch.allowList, []);
    assert.ok(mismatch.events.items.every((entry) => entry.blockingReasons.includes("funnel_mismatch")));

    const first = await preview({ funnelId: sourceFunnel.id, pageId, formId, origin, limit: 1, offset: 0 });
    const second = await preview({ funnelId: sourceFunnel.id, pageId, formId, origin, limit: 1, offset: 1 });
    assert.equal(first.preview.digest, second.preview.digest);
    assert.equal(first.events.total, 3);
    assert.notEqual(first.events.items[0]?.sourceEventId, second.events.items[0]?.sourceEventId);
    assert.deepEqual(first.allowList, [...ids].sort());
  });

  it("rejects a write inside the preview transaction", async () => {
    const stamp = uniqueStamp();
    const pageId = facebookId("95", stamp);
    const formId = facebookId("85", stamp);
    const row = await event({ pageId, formId });
    await assert.rejects(() =>
      withReadOnlyRepeatableRead(db, (tx) =>
        tx.sourceLeadEvent.update({ where: { id: row.id }, data: { errorSummary: "should-not-write" } })
      )
    );
    const stored = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(stored.errorSummary, null);
  });

  it("completes a read-only preview that runs longer than five seconds without changing eligibility", { timeout: 20_000 }, async () => {
    const stamp = uniqueStamp();
    const pageId = facebookId("96", stamp);
    const formId = facebookId("86", stamp);
    const origin = await client(stamp);
    const sourceFunnel = await funnel({ clientAccountId: origin, pageId, formId });
    const row = await event({ pageId, formId });
    const before = await counts();
    const now = new Date("2026-11-09T16:00:00.000Z");
    const query = {
      sourceFunnelId: sourceFunnel.id,
      pageId,
      formId,
      originClientAccountId: origin,
      confirmedAt: CONFIRMED_AT,
      limit: 25,
      offset: 0,
      decision: "all" as const,
      includeAllowList: true,
    };
    const fast = await loadFacebookAssociationCorrectionPreview(query, db, now);
    const started = Date.now();
    const slow = await loadFacebookAssociationCorrectionPreview(query, withLifecyclePause(db, { seconds: 6 }), now);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 6_000, `elapsed ${elapsed}`);
    assert.ok(elapsed < PREVIEW_TRANSACTION_TIMEOUT_MS, `elapsed ${elapsed}`);
    assert.equal(slow.events.items[0]?.decision, "eligible");
    assert.equal(slow.events.items[0]?.decision, fast.events.items[0]?.decision);
    assert.equal(slow.preview.digest, fast.preview.digest);
    assert.deepEqual(slow.allowList, fast.allowList);
    assert.deepEqual(slow.allowList, [row.id]);
    assert.equal(slow.writesPerformed, false);
    assert.equal(slow.correctionEnabled, false);
    assert.equal(slow.verification.complete, true);
    const stored = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(stored.updatedAt.toISOString(), row.updatedAt.toISOString());
    assert.equal(stored.clientAccountIdResolved, null);
    assert.deepEqual(await counts(), before);
  });

  it("fails closed when the preview transaction exceeds fifteen seconds", { timeout: 30_000 }, async () => {
    const stamp = uniqueStamp();
    const pageId = facebookId("97", stamp);
    const formId = facebookId("87", stamp);
    const origin = await client(stamp);
    const sourceFunnel = await funnel({ clientAccountId: origin, pageId, formId });
    const row = await event({ pageId, formId });
    const before = await counts();
    let returned: unknown = "not-returned";
    const started = Date.now();
    await assert.rejects(
      async () => {
        returned = await loadFacebookAssociationCorrectionPreview(
          {
            sourceFunnelId: sourceFunnel.id,
            pageId,
            formId,
            originClientAccountId: origin,
            confirmedAt: CONFIRMED_AT,
            limit: 25,
            offset: 0,
            decision: "all",
            includeAllowList: true,
          },
          withLifecyclePause(db, { seconds: 8, everyCall: true })
        );
      },
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2028" &&
        error.message.includes("15000 ms")
    );
    assert.ok(Date.now() - started >= PREVIEW_TRANSACTION_TIMEOUT_MS - 1_000);
    assert.equal(returned, "not-returned");
    const stored = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(stored.updatedAt.toISOString(), row.updatedAt.toISOString());
    assert.equal(stored.clientAccountIdResolved, null);
    assert.equal(stored.errorSummary, null);
    assert.deepEqual(await counts(), before);
  });

  it("cancels one statement before the transaction budget and leaves the database unchanged", { timeout: 20_000 }, async () => {
    const stamp = uniqueStamp();
    const pageId = facebookId("98", stamp);
    const formId = facebookId("88", stamp);
    const row = await event({ pageId, formId });
    const beforeTimeout = await statementTimeout(db);
    const before = await counts();
    const started = Date.now();
    await assert.rejects(
      () => withReadOnlyRepeatableRead(db, (tx) => tx.$queryRaw`SELECT pg_sleep(13)::text`),
      (error: unknown) => /statement timeout|57014/i.test(error instanceof Error ? error.message : String(error))
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= PREVIEW_STATEMENT_TIMEOUT_MS - 1_000, `elapsed ${elapsed}`);
    assert.ok(elapsed < PREVIEW_TRANSACTION_TIMEOUT_MS, `elapsed ${elapsed}`);
    assert.equal(await statementTimeout(db), beforeTimeout);
    const stored = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(stored.updatedAt.toISOString(), row.updatedAt.toISOString());
    assert.deepEqual(await counts(), before);
  });

  it("returns no preview when relation evidence fails", async () => {
    const stamp = uniqueStamp();
    const pageId = facebookId("99", stamp);
    const formId = facebookId("89", stamp);
    const origin = await client(stamp);
    const sourceFunnel = await funnel({ clientAccountId: origin, pageId, formId });
    const row = await event({ pageId, formId });
    const before = await counts();
    let returned: unknown = "not-returned";
    await assert.rejects(async () => {
      returned = await loadFacebookAssociationCorrectionPreview(
        {
          sourceFunnelId: sourceFunnel.id,
          pageId,
          formId,
          originClientAccountId: origin,
          confirmedAt: CONFIRMED_AT,
          limit: 25,
          offset: 0,
          decision: "all",
          includeAllowList: true,
        },
        withLifecyclePause(db, { seconds: 0, fail: "relation_evidence_incomplete" })
      );
    }, /relation_evidence_incomplete/);
    assert.equal(returned, "not-returned");
    const stored = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(stored.clientAccountIdResolved, null);
    assert.equal(stored.updatedAt.toISOString(), row.updatedAt.toISOString());
    assert.deepEqual(await counts(), before);
    const retry = await preview({ funnelId: sourceFunnel.id, pageId, formId, origin });
    assert.equal(retry.events.items.find((entry) => entry.sourceEventId === row.id)?.decision, "eligible");
    assert.deepEqual(retry.allowList, [row.id]);
  });

  async function counts() {
    return {
      events: await db.sourceLeadEvent.count(),
      funnels: await db.sourceFunnel.count(),
      outbox: await db.fulfillmentOutbox.count(),
    };
  }
});

async function statementTimeout(db: PrismaClient): Promise<string> {
  const rows = await db.$queryRaw<Array<{ statement_timeout: string }>>`SHOW statement_timeout`;
  return rows[0]?.statement_timeout ?? "";
}

function withLifecyclePause(
  db: PrismaClient,
  options: { seconds: number; everyCall?: boolean; fail?: string }
): PrismaClient {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== "$transaction") {
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      }
      const transaction = target.$transaction.bind(target) as (
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        transactionOptions?: { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number }
      ) => Promise<unknown>;
      return (
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        transactionOptions?: { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number }
      ) =>
        transaction(async (tx) => {
          let paused = false;
          const findMany = tx.lifecycleEvent.findMany.bind(tx.lifecycleEvent);
          const wrapped = new Proxy(tx, {
            get(txTarget, txProp, txReceiver) {
              if (txProp !== "lifecycleEvent") {
                const value = Reflect.get(txTarget, txProp, txReceiver);
                return typeof value === "function" ? value.bind(txTarget) : value;
              }
              return {
                findMany: async (args: Parameters<typeof findMany>[0]) => {
                  if (options.fail) throw new Error(options.fail);
                  if (options.everyCall || !paused) {
                    paused = true;
                    if (options.seconds > 0) await tx.$queryRaw`SELECT pg_sleep(${options.seconds})::text`;
                  }
                  return findMany(args);
                },
              };
            },
          });
          return callback(wrapped as Prisma.TransactionClient);
        }, transactionOptions);
    },
  }) as PrismaClient;
}
