/**
 * Real PostgreSQL claim-gate tests across separate Prisma sessions.
 *
 * Requires local Docker Postgres. Default URL:
 *   postgresql://sa360:sa360password@127.0.0.1:5432/sa360_facets_claim_lock_test
 *
 * Override with SA360_FACET_SNAPSHOT_CLAIM_DATABASE_URL (localhost/127.0.0.1 only).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { LeadInventoryFacetBuildStatus, PrismaClient } from "@prisma/client";

import {
  claimFacetSnapshotRebuild,
  FACET_SNAPSHOT_IN_FLIGHT_STALE_MS,
  __facetSnapshotTestUtils,
} from "./lead-inventory-facet-snapshot.service.js";

const DEFAULT_URL =
  "postgresql://sa360:sa360password@127.0.0.1:5432/sa360_facets_claim_lock_test";

function assertLocalhost(url: string): string {
  const host = new URL(url).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`DATABASE_URL_remote_blocked:${host}`);
  }
  return url;
}

const integrationUrl = assertLocalhost(
  process.env.SA360_FACET_SNAPSHOT_CLAIM_DATABASE_URL?.trim() || DEFAULT_URL
);

async function canConnect(url: string): Promise<boolean> {
  const probe = new PrismaClient({ datasources: { db: { url } } });
  try {
    await probe.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.$disconnect().catch(() => undefined);
  }
}

const runIntegration = await canConnect(integrationUrl);

function newClient(): PrismaClient {
  // Separate PrismaClient instances → separate pools → separate backend sessions.
  return new PrismaClient({
    datasources: {
      db: { url: `${integrationUrl}${integrationUrl.includes("?") ? "&" : "?"}connection_limit=2` },
    },
  });
}

describe(
  "facet snapshot claim gate (real PostgreSQL sessions)",
  { skip: !runIntegration },
  () => {
    let dbA: PrismaClient;
    let dbB: PrismaClient;
    const createdIds: string[] = [];

    before(async () => {
      dbA = newClient();
      dbB = newClient();
      // Prove backends are distinct sessions (pid differs across clients).
      const pidA = await dbA.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      const pidB = await dbB.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      assert.notEqual(pidA[0]?.pid, pidB[0]?.pid, "expected distinct PostgreSQL backend sessions");
    });

    after(async () => {
      if (createdIds.length > 0) {
        await dbA.leadInventoryFacetBuild
          .deleteMany({ where: { id: { in: createdIds } } })
          .catch(() => undefined);
      }
      await dbA.$disconnect().catch(() => undefined);
      await dbB.$disconnect().catch(() => undefined);
    });

    async function track(id: string): Promise<string> {
      createdIds.push(id);
      return id;
    }

    it("concurrent claim: A claims, B skips while A remains building", async () => {
      const version = `claim_concurrent_${Date.now()}`;
      const buildA = await track(__facetSnapshotTestUtils.newBuildId());
      const buildB = await track(__facetSnapshotTestUtils.newBuildId());

      const a = await claimFacetSnapshotRebuild({
        ageBandVersion: version,
        buildId: buildA,
        evaluatedAt: new Date(),
        db: dbA,
        skipIfLocked: true,
      });
      assert.equal(a.claimed, true);
      if (!a.claimed) return;

      const b = await claimFacetSnapshotRebuild({
        ageBandVersion: version,
        buildId: buildB,
        evaluatedAt: new Date(),
        db: dbB,
        skipIfLocked: true,
      });
      assert.equal(b.claimed, false);
      if (b.claimed) return;
      assert.equal(b.reason, "rebuild_already_running");
      assert.equal(b.existingBuildId, buildA);

      const building = await dbA.leadInventoryFacetBuild.findMany({
        where: {
          ageBandVersion: version,
          status: LeadInventoryFacetBuildStatus.building,
        },
        select: { id: true },
      });
      assert.equal(building.length, 1);
      assert.equal(building[0]?.id, buildA);

      // B's build id must not exist.
      const ghost = await dbA.leadInventoryFacetBuild.findUnique({ where: { id: buildB } });
      assert.equal(ghost, null);
    });

    it("different ageBandVersion claims do not block each other", async () => {
      const suffix = Date.now();
      const versionX = `claim_ver_x_${suffix}`;
      const versionY = `claim_ver_y_${suffix}`;
      const buildX = await track(__facetSnapshotTestUtils.newBuildId());
      const buildY = await track(__facetSnapshotTestUtils.newBuildId());

      const x = await claimFacetSnapshotRebuild({
        ageBandVersion: versionX,
        buildId: buildX,
        evaluatedAt: new Date(),
        db: dbA,
      });
      const y = await claimFacetSnapshotRebuild({
        ageBandVersion: versionY,
        buildId: buildY,
        evaluatedAt: new Date(),
        db: dbB,
      });
      assert.equal(x.claimed, true);
      assert.equal(y.claimed, true);
    });

    it("completed active/failed builds do not block a later claim", async () => {
      const version = `claim_completed_${Date.now()}`;
      const priorActive = await track(__facetSnapshotTestUtils.newBuildId());
      const priorFailed = await track(__facetSnapshotTestUtils.newBuildId());
      const next = await track(__facetSnapshotTestUtils.newBuildId());

      await dbA.leadInventoryFacetBuild.create({
        data: {
          id: priorActive,
          ageBandVersion: version,
          evaluatedAt: new Date(),
          status: LeadInventoryFacetBuildStatus.active,
          validationOk: true,
          activatedAt: new Date(),
          inventoryCount: 1,
          aggregateRowCount: 1,
        },
      });
      await dbA.leadInventoryFacetBuild.create({
        data: {
          id: priorFailed,
          ageBandVersion: version,
          evaluatedAt: new Date(),
          status: LeadInventoryFacetBuildStatus.failed,
          validationOk: false,
          failureCode: "prior_fail",
          inventoryCount: 0,
          aggregateRowCount: 0,
        },
      });

      const claim = await claimFacetSnapshotRebuild({
        ageBandVersion: version,
        buildId: next,
        evaluatedAt: new Date(),
        db: dbB,
      });
      assert.equal(claim.claimed, true);
      if (!claim.claimed) return;
      assert.equal(claim.buildId, next);

      const stillActive = await dbA.leadInventoryFacetBuild.findUnique({
        where: { id: priorActive },
      });
      assert.equal(stillActive?.status, LeadInventoryFacetBuildStatus.active);
    });

    it("stale building/validated claims are marked failed and permit recovery", async () => {
      const version = `claim_stale_${Date.now()}`;
      const staleBuilding = await track(__facetSnapshotTestUtils.newBuildId());
      const staleValidated = await track(__facetSnapshotTestUtils.newBuildId());
      const recovered = await track(__facetSnapshotTestUtils.newBuildId());
      const staleCreatedAt = new Date(Date.now() - FACET_SNAPSHOT_IN_FLIGHT_STALE_MS - 5_000);

      await dbA.leadInventoryFacetBuild.create({
        data: {
          id: staleBuilding,
          ageBandVersion: version,
          evaluatedAt: staleCreatedAt,
          status: LeadInventoryFacetBuildStatus.building,
          createdAt: staleCreatedAt,
          inventoryCount: 0,
          aggregateRowCount: 0,
          validationOk: false,
        },
      });
      await dbA.leadInventoryFacetBuild.create({
        data: {
          id: staleValidated,
          ageBandVersion: version,
          evaluatedAt: staleCreatedAt,
          status: LeadInventoryFacetBuildStatus.validated,
          createdAt: staleCreatedAt,
          inventoryCount: 0,
          aggregateRowCount: 0,
          validationOk: true,
        },
      });

      const claim = await claimFacetSnapshotRebuild({
        ageBandVersion: version,
        buildId: recovered,
        evaluatedAt: new Date(),
        db: dbB,
      });
      assert.equal(claim.claimed, true);
      if (!claim.claimed) return;
      assert.ok(claim.recoveredStaleBuildIds.includes(staleBuilding));
      assert.ok(claim.recoveredStaleBuildIds.includes(staleValidated));

      const buildingRow = await dbA.leadInventoryFacetBuild.findUnique({
        where: { id: staleBuilding },
      });
      const validatedRow = await dbA.leadInventoryFacetBuild.findUnique({
        where: { id: staleValidated },
      });
      assert.equal(buildingRow?.status, LeadInventoryFacetBuildStatus.failed);
      assert.equal(buildingRow?.failureCode, "stale_build_recovered");
      assert.equal(validatedRow?.status, LeadInventoryFacetBuildStatus.failed);
      assert.equal(validatedRow?.failureCode, "stale_build_recovered");

      const newRow = await dbA.leadInventoryFacetBuild.findUnique({ where: { id: recovered } });
      assert.equal(newRow?.status, LeadInventoryFacetBuildStatus.building);
    });

    it("active snapshot does not count as an in-flight rebuild claim", async () => {
      const version = `claim_active_only_${Date.now()}`;
      const activeId = await track(__facetSnapshotTestUtils.newBuildId());
      const nextId = await track(__facetSnapshotTestUtils.newBuildId());

      await dbA.leadInventoryFacetBuild.create({
        data: {
          id: activeId,
          ageBandVersion: version,
          evaluatedAt: new Date(),
          status: LeadInventoryFacetBuildStatus.active,
          validationOk: true,
          activatedAt: new Date(),
          inventoryCount: 2,
          aggregateRowCount: 1,
        },
      });

      const claim = await claimFacetSnapshotRebuild({
        ageBandVersion: version,
        buildId: nextId,
        evaluatedAt: new Date(),
        db: dbB,
      });
      assert.equal(claim.claimed, true);
      if (!claim.claimed) return;
      assert.deepEqual(claim.recoveredStaleBuildIds, []);

      const active = await dbA.leadInventoryFacetBuild.findUnique({ where: { id: activeId } });
      assert.equal(active?.status, LeadInventoryFacetBuildStatus.active);
    });

    it("claim leaves no session advisory locks after commit", async () => {
      const version = `claim_xact_only_${Date.now()}`;
      const buildId = await track(__facetSnapshotTestUtils.newBuildId());
      const lockKey = __facetSnapshotTestUtils.advisoryLockKey(version);
      const objid = lockKey >>> 0;
      // Sign-extended bigint key encoding uses high 32 bits as classid.
      const signExtendedClassid = lockKey < 0 ? 0xffffffff : 0;

      const claim = await claimFacetSnapshotRebuild({
        ageBandVersion: version,
        buildId,
        evaluatedAt: new Date(),
        db: dbA,
      });
      assert.equal(claim.claimed, true);

      // pg_locks is cluster-visible. Transaction-scoped locks are gone after COMMIT;
      // a leaked session lock for this key would still appear here.
      const locks = await dbB.$queryRaw<Array<{ classid: number | bigint; objid: number | bigint }>>`
        SELECT classid, objid
        FROM pg_locks
        WHERE locktype = 'advisory'
          AND granted = true
      `;
      const matched = locks.filter((row) => {
        const classid = Number(row.classid);
        const id = Number(row.objid);
        return (
          id === objid &&
          (classid === 0 || classid === signExtendedClassid)
        );
      });
      assert.equal(matched.length, 0, `leaked advisory locks=${JSON.stringify(matched)}`);
    });
  }
);
