import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrismaClient } from "@prisma/client";

import { listLeadInventoryItems } from "./lead-inventory.repository.js";

test("admin nicheKey filter stays exact while commerce matching expands aliases", async () => {
  const captured: {
    where: {
      nicheKey?: { equals: string; mode: string };
      OR?: Array<{ nicheKey: { equals: string } }>;
    } | null;
  } = { where: null };
  const db = {
    leadInventoryItem: {
      findMany: async (args: { where: NonNullable<(typeof captured)["where"]> }) => {
        captured.where = args.where;
        return [];
      },
    },
  } as unknown as PrismaClient;

  await listLeadInventoryItems({ nicheKey: "vet_fex" }, db);
  const exactWhere = captured.where;
  assert.deepEqual(exactWhere?.nicheKey, { equals: "vet_fex", mode: "insensitive" });
  assert.equal(exactWhere?.OR, undefined);

  await listLeadInventoryItems({ commerceNicheKey: "vet" }, db);
  const clauses = captured.where?.OR;
  if (!clauses) throw new Error("expected commerce alias clauses");
  const keys = clauses.map((clause) => clause.nicheKey.equals);
  assert.ok(keys.includes("vet"));
  assert.ok(keys.includes("vet_fex"));
  assert.equal(captured.where?.nicheKey, undefined);
});
