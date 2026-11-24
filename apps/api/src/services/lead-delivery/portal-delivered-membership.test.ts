import assert from "node:assert/strict";
import test from "node:test";

import { buildSourceLeadEventWhere } from "../../repositories/source-lead-event.repository.js";
import {
  PORTAL_DELIVERED_MAX_SCAN,
  PORTAL_DELIVERED_SCAN_BATCH,
  scanPortalDeliveredMembership,
} from "./portal-delivered-membership.js";

test("source-status delivered stays a source filter, and search and date share that WHERE", () => {
  const where = buildSourceLeadEventWhere({
    status: "delivered",
    clientAccountIdResolved: "client_a",
    search: "Quartz",
    receivedFrom: new Date("2026-11-01T00:00:00.000Z"),
    receivedTo: new Date("2026-11-30T23:59:59.999Z"),
  });
  assert.equal(where.status, "delivered");
  assert.equal(where.clientAccountIdResolved, "client_a");
  assert.deepEqual(where.receivedAt, {
    gte: new Date("2026-11-01T00:00:00.000Z"),
    lte: new Date("2026-11-30T23:59:59.999Z"),
  });
  const search = Array.isArray(where.AND) ? where.AND[0] : where.AND;
  assert.ok(search && typeof search === "object" && "OR" in search);
});

test("customer membership scan fills a page before later rows and continues exactly once", async () => {
  const rows = [
    { id: "filler_1", delivered: false },
    { id: "canonical_a", delivered: true },
    { id: "unverified", delivered: false },
    { id: "legacy_a", delivered: true },
    { id: "uncertain", delivered: false },
    { id: "canonical_b", delivered: true },
    { id: "filler_2", delivered: false },
    { id: "legacy_b", delivered: true },
    { id: "filler_3", delivered: false },
    { id: "canonical_c", delivered: true },
  ];
  const limits: number[] = [];
  const loadPage = async (args: { limit: number; cursor?: string }) => {
    limits.push(args.limit);
    assert.ok(args.limit <= PORTAL_DELIVERED_SCAN_BATCH);
    const start = args.cursor ? rows.findIndex((row) => row.id === args.cursor) + 1 : 0;
    const slice = rows.slice(start, start + args.limit);
    const hasMore = start + slice.length < rows.length;
    return {
      items: slice,
      nextCursor: hasMore ? slice[slice.length - 1]?.id ?? null : null,
    };
  };

  const seen: string[] = [];
  let cursor: string | undefined;
  const pageLengths: number[] = [];
  for (let guard = 0; guard < 10; guard += 1) {
    const page = await scanPortalDeliveredMembership({
      pageLimit: 2,
      batchSize: 4,
      cursor,
      loadPage,
      isDelivered: (row) => row.delivered,
    });
    pageLengths.push(page.items.length);
    seen.push(...page.items.map((row) => row.id));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  assert.deepEqual(seen, ["canonical_a", "legacy_a", "canonical_b", "legacy_b", "canonical_c"]);
  assert.deepEqual(pageLengths, [2, 2, 1]);
  assert.equal(new Set(seen).size, seen.length);
  assert.ok(limits.every((limit) => limit <= 4));
  assert.ok(limits.every((limit) => limit <= PORTAL_DELIVERED_MAX_SCAN));
});

test("a short scan budget resumes at the last examined row", async () => {
  const rows = [
    { id: "skip_1", delivered: false },
    { id: "skip_2", delivered: false },
    { id: "keep_1", delivered: true },
    { id: "skip_3", delivered: false },
    { id: "keep_2", delivered: true },
  ];
  const loadPage = async (args: { limit: number; cursor?: string }) => {
    const start = args.cursor ? rows.findIndex((row) => row.id === args.cursor) + 1 : 0;
    const slice = rows.slice(start, start + args.limit);
    return {
      items: slice,
      nextCursor: start + slice.length < rows.length ? slice[slice.length - 1]?.id ?? null : null,
    };
  };
  const first = await scanPortalDeliveredMembership({
    pageLimit: 2,
    maxScan: 3,
    batchSize: 2,
    loadPage,
    isDelivered: (row) => row.delivered,
  });
  assert.deepEqual(
    first.items.map((row) => row.id),
    ["keep_1"]
  );
  assert.equal(first.nextCursor, "keep_1");
  assert.equal(first.scanned, 3);

  const second = await scanPortalDeliveredMembership({
    pageLimit: 2,
    maxScan: 3,
    batchSize: 2,
    cursor: first.nextCursor ?? undefined,
    loadPage,
    isDelivered: (row) => row.delivered,
  });
  assert.deepEqual(
    second.items.map((row) => row.id),
    ["keep_2"]
  );
  assert.equal(second.nextCursor, null);
});
