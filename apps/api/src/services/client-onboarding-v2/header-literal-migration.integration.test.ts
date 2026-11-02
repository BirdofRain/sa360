/**
 * The header migration allows "" and does not rewrite stored cells.
 * The U+200B sentinel writer never shipped: it is not on master.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { exactHeader, headerFingerprint, readHeaderSnapshot } from "../../lib/sheet-header-snapshot.js";
import { createColumnMapDraft, listColumnMaps, saveAndPublishColumnMap } from "./column-maps.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const migrationPath = join(
  import.meta.dirname,
  "../../../../../prisma/migrations/20261102200000_client_sheet_header_literal/migration.sql"
);
const migrationSql = readFileSync(migrationPath, "utf8");

function sqlStatements(sql: string): string[] {
  return sql
    .split(/;\n\n/)
    .map((part, index, all) => (index < all.length - 1 ? `${part};` : part.trim()))
    .filter((part) => part.replace(/--.*$/gm, "").trim().length > 0);
}

const OLD_CONSTRAINT = `
ALTER TABLE "ClientSheetColumnMap" DROP CONSTRAINT "ClientSheetColumnMap_scope_chk";

ALTER TABLE "ClientSheetColumnMap"
  ADD CONSTRAINT "ClientSheetColumnMap_scope_chk" CHECK (
    "mapVersion" >= 1
    AND "revision" >= 1
    AND "worksheetId" >= 0
    AND char_length("spreadsheetId") BETWEEN 1 AND 200
    AND char_length("baseSchemaVersion") BETWEEN 1 AND 80
    AND (
      "sourceScope" = 'shared'
      OR "sourceScope" ~ '^funnel:[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    )
    AND client_onboarding_v2_string_array_ok("headerSnapshot", 1, 80)
    AND jsonb_typeof("assignments") = 'array'
  );
`;

test("header migration changes the check and does not rewrite cells", () => {
  assert.match(migrationSql, /CREATE OR REPLACE FUNCTION client_onboarding_v2_header_snapshot_ok/);
  assert.match(migrationSql, /char_length\(item #>> '\{\}'\) > 200/);
  assert.doesNotMatch(migrationSql, /UPDATE\s+"ClientSheetColumnMap"/i);
  assert.doesNotMatch(migrationSql, /UPDATE\s+"CompanySheetsDeliveryJob"/i);
  assert.equal(migrationSql.includes("E'\\u200b'"), false);
  assert.equal(migrationSql.includes("DELETE"), false);
});

describe("header migration from the length 1–200 check", { skip: !runIntegration }, () => {
  let db: PrismaClient;

  it("keeps a literal U+200B header, accepts a new empty header, and republishes that literal", async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
    const suffix = `${Date.now()}`;
    const clientAccountId = `hdr_${suffix}`;
    const spreadsheetId = `hdrSheet${suffix}`;
    const literalHeader = ["Full Name", "\u200b"];
    const normalHeader = ["Phone Number", "E-mail"];
    const emptyHeader = ["Phone Number", ""];
    const assignments = [{ columnIndex: 0, sheetHeader: "Full Name", decision: "mapped", explicit: true }];
    let failed: unknown = null;

    try {
      await db.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`
            UPDATE "ClientSheetColumnMap"
            SET "headerSnapshot" = (
              SELECT jsonb_agg(
                CASE WHEN item #>> '{}' = '' THEN to_jsonb('length-held'::text) ELSE item END
                ORDER BY ord
              )
              FROM jsonb_array_elements("headerSnapshot") WITH ORDINALITY AS cells(item, ord)
            )
            WHERE EXISTS (
              SELECT 1 FROM jsonb_array_elements("headerSnapshot") AS item
              WHERE item #>> '{}' = ''
            )
          `);
          for (const statement of sqlStatements(OLD_CONSTRAINT)) {
            await tx.$executeRawUnsafe(statement);
          }

          await tx.clientAccount.create({
            data: { clientAccountId, clientDisplayName: clientAccountId, status: "active" },
          });
          const publishedAt = new Date("2026-11-02T18:00:00.000Z");
          const literal = await tx.clientSheetColumnMap.create({
            data: {
              clientAccountId,
              sourceScope: "shared",
              spreadsheetId,
              worksheetId: 7,
              mapVersion: 1,
              status: "published",
              baseSchemaVersion: "legacy_custom",
              headerSnapshot: literalHeader,
              assignments,
              revision: 4,
              publishedAt,
            },
          });
          const normal = await tx.clientSheetColumnMap.create({
            data: {
              clientAccountId,
              sourceScope: "shared",
              spreadsheetId,
              worksheetId: 8,
              mapVersion: 1,
              status: "draft",
              baseSchemaVersion: "legacy_custom",
              headerSnapshot: normalHeader,
              assignments: [],
              revision: 2,
            },
          });
          await tx.$executeRawUnsafe(`
            DO $do$
            BEGIN
              INSERT INTO "ClientSheetColumnMap" (
                id, "clientAccountId", "sourceScope", "spreadsheetId", "worksheetId",
                "mapVersion", status, "baseSchemaVersion", "headerSnapshot", assignments,
                revision, "createdAt", "updatedAt"
              ) VALUES (
                'hdr_empty_${suffix}',
                '${clientAccountId}',
                'shared',
                '${spreadsheetId}',
                9,
                1,
                'draft',
                'legacy_custom',
                '["Phone Number", ""]'::jsonb,
                '[]'::jsonb,
                1,
                now(),
                now()
              );
              RAISE EXCEPTION 'empty header was accepted under the old check';
            EXCEPTION
              WHEN check_violation THEN
                NULL;
            END
            $do$;
          `);

          for (const statement of sqlStatements(migrationSql)) {
            await tx.$executeRawUnsafe(statement);
          }

          const literalAfter = await tx.clientSheetColumnMap.findUniqueOrThrow({ where: { id: literal.id } });
          const normalAfter = await tx.clientSheetColumnMap.findUniqueOrThrow({ where: { id: normal.id } });
          assert.deepEqual(literalAfter.headerSnapshot, literalHeader);
          assert.deepEqual(literalAfter.assignments, assignments);
          assert.equal(literalAfter.revision, 4);
          assert.equal(literalAfter.status, "published");
          assert.equal(literalAfter.publishedAt?.toISOString(), publishedAt.toISOString());
          assert.equal(literalAfter.worksheetId, 7);
          assert.deepEqual(normalAfter.headerSnapshot, normalHeader);
          assert.equal(normalAfter.revision, 2);
          assert.equal(normalAfter.status, "draft");
          assert.equal(exactHeader(readHeaderSnapshot(literalAfter.headerSnapshot), literalHeader), true);
          assert.equal(exactHeader(readHeaderSnapshot(literalAfter.headerSnapshot), ["Full Name", ""]), false);
          assert.equal(headerFingerprint(readHeaderSnapshot(literalAfter.headerSnapshot)), headerFingerprint(literalHeader));

          const createdEmpty = await tx.clientSheetColumnMap.create({
            data: {
              clientAccountId,
              sourceScope: "shared",
              spreadsheetId,
              worksheetId: 9,
              mapVersion: 1,
              status: "draft",
              baseSchemaVersion: "legacy_custom",
              headerSnapshot: emptyHeader,
              assignments: [],
              revision: 1,
            },
          });
          assert.deepEqual(createdEmpty.headerSnapshot, emptyHeader);
          assert.equal(exactHeader(readHeaderSnapshot(createdEmpty.headerSnapshot), emptyHeader), true);
          assert.equal(exactHeader(readHeaderSnapshot(createdEmpty.headerSnapshot), ["Phone Number", "\u200b"]), false);

          const connection = await tx.companyGoogleConnection.create({
            data: {
              connectionKey: `hdr-${suffix}`,
              googleUserId: `hdr-${suffix}`,
              googleEmail: "headers@lifeagentlaunch.test",
              status: "disconnected",
              scopes: ["openid"],
              tokenVersion: 1,
            },
          });
          await tx.companySheetsDestination.create({
            data: {
              clientAccountId,
              companyConnectionId: connection.id,
              spreadsheetId,
              spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
              worksheetId: 7,
              worksheetTitle: "Literal",
              controlBasis: "drive_owner_verified",
              accessStatus: "readable",
              sharingStatus: "missing_recipient",
              enabled: false,
              campaignDispatchEnabled: false,
            },
          });
          const job = await tx.companySheetsDeliveryJob.create({
            data: {
              kind: "lead",
              status: "succeeded",
              clientAccountId,
              companyConnectionId: connection.id,
              spreadsheetId,
              spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
              worksheetId: 7,
              worksheetTitle: "Literal",
              controlBasis: "drive_owner_verified",
              destinationUpdatedAt: publishedAt,
              headerContract: literalHeader,
              schemaVersion: "legacy_custom",
              destinationRevision: 1,
              rowsTotal: 1,
              rowsWritten: 1,
              idempotencyKey: `hdr-job-${suffix}`,
            },
          });
          const jobAfter = await tx.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: job.id } });
          assert.deepEqual(jobAfter.headerContract, literalHeader);
          assert.equal(jobAfter.status, "succeeded");
          assert.equal(jobAfter.rowsWritten, 1);

          throw new Error("rollback-header-migration-fixture");
        },
        { maxWait: 20_000, timeout: 60_000 }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("rollback-header-migration-fixture")) failed = error;
    }
    if (failed) throw failed;

    const connection = await db.companyGoogleConnection.create({
      data: {
        connectionKey: `hdr-pub-${suffix}`,
        googleUserId: `hdr-pub-${suffix}`,
        googleEmail: "headers-pub@lifeagentlaunch.test",
        status: "disconnected",
        scopes: ["openid"],
        tokenVersion: 1,
      },
    });
    await db.clientAccount.create({
      data: { clientAccountId, clientDisplayName: clientAccountId, status: "active" },
    });
    await db.companySheetsDestination.create({
      data: {
        clientAccountId,
        companyConnectionId: connection.id,
        spreadsheetId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
        worksheetId: 11,
        worksheetTitle: "Empty header",
        controlBasis: "drive_owner_verified",
        accessStatus: "readable",
        sharingStatus: "missing_recipient",
        enabled: false,
        campaignDispatchEnabled: false,
      },
    });
    try {
      const draft = await createColumnMapDraft(
        {
          clientAccountId,
          requestId: randomUUID(),
          spreadsheetId,
          worksheetId: 11,
          sourceScope: "shared",
          baseSchemaVersion: "legacy_custom",
          snapshot: {
            spreadsheetId,
            spreadsheetTitle: "Existing workbook",
            worksheetId: 11,
            worksheetTitle: "Empty header",
            header: emptyHeader,
            sampleRow: ["5550002222", ""],
            classification: "legacy_custom_required",
            historicalDataRows: "has_rows",
          },
        },
        db
      );
      assert.equal(draft.ok, true);
      if (!draft.ok) return;
      assert.deepEqual(draft.map.headerSnapshot, emptyHeader);
      const chosen = draft.map.assignments.map((column) =>
        column.sheetHeader === "Phone Number"
          ? { ...column, decision: "mapped" as const, explicit: true, target: column.target, transform: "passthrough" as const, code: null }
          : { ...column, decision: "unmapped" as const, explicit: true, transform: "blank" as const, target: null, code: "blank_header" }
      );
      const published = await saveAndPublishColumnMap(
        {
          clientAccountId,
          mapId: draft.map.id,
          requestId: randomUUID(),
          expectedRevision: draft.map.revision,
          assignments: chosen,
          snapshot: {
            spreadsheetId,
            spreadsheetTitle: "Existing workbook",
            worksheetId: 11,
            worksheetTitle: "Empty header",
            header: emptyHeader,
            sampleRow: ["5550002222", ""],
            classification: "legacy_custom_required",
            historicalDataRows: "has_rows",
          },
        },
        db
      );
      assert.equal(published.ok, true, published.ok ? "" : `${published.error} ${published.detail ?? ""}`);
      if (!published.ok) return;
      assert.equal(published.published, true);
      assert.equal(published.deliveryEnabled, false);
      assert.deepEqual(published.map.headerSnapshot, emptyHeader);
      const reopened = await listColumnMaps(clientAccountId, 11, db);
      assert.equal(reopened.ok, true);
      if (!reopened.ok) return;
      const found = reopened.maps.find((map) => map.id === draft.map.id);
      assert.equal(found?.status, "published");
      assert.equal(found?.worksheetId, 11);
      assert.deepEqual(found?.headerSnapshot, emptyHeader);
      assert.equal(exactHeader(readHeaderSnapshot(found?.headerSnapshot), emptyHeader), true);
      assert.equal(headerFingerprint(readHeaderSnapshot(found?.headerSnapshot)), headerFingerprint(emptyHeader));
    } finally {
      await db.companySheetsDeliveryJob.deleteMany({ where: { clientAccountId } });
      await db.clientSheetColumnMap.deleteMany({ where: { clientAccountId } });
      await db.companySheetsDestination.deleteMany({ where: { clientAccountId } });
      await db.companyGoogleConnection.deleteMany({ where: { id: connection.id } });
      await db.clientAccount.deleteMany({ where: { clientAccountId } });
      await db.$disconnect();
    }
  });
});
