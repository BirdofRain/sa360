import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrismaClient } from "@prisma/client";

import { decideLeadReplacement } from "./replacement.service.js";

test("availability interest blocks replacement before any mutation", async () => {
  const previous = process.env.SA360_PPL_REPLACEMENT_ENABLED;
  process.env.SA360_PPL_REPLACEMENT_ENABLED = "true";
  let mutated = false;
  const db = {
    leadReplacementRequest: {
      findUnique: async () => ({
        id: "rep_1",
        status: "requested",
        leadOrderId: "ord_interest",
        originalAllocationId: "alloc_1",
      }),
      update: async () => {
        mutated = true;
        return {};
      },
    },
    leadOrder: {
      findUnique: async () => ({
        campaignType: "availability_interest:fresh_leads",
        notes: null,
      }),
    },
    leadAllocation: {
      update: async () => {
        mutated = true;
        return {};
      },
      updateMany: async () => {
        mutated = true;
        return { count: 1 };
      },
    },
    leadInventoryItem: {
      update: async () => {
        mutated = true;
        return {};
      },
    },
  } as unknown as PrismaClient;

  try {
    const blocked = await decideLeadReplacement(
      { replacementId: "rep_1", action: "approve", confirmationPhrase: "APPROVE REPLACEMENT" },
      db
    );
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "availability_interest_only");
    assert.equal(mutated, false);

    const legacyDb = {
      ...db,
      leadOrder: {
        findUnique: async () => ({
          campaignType: "Fresh leads",
          notes: null,
        }),
      },
    } as unknown as PrismaClient;
    const legacy = await decideLeadReplacement(
      { replacementId: "rep_1", action: "approve" },
      legacyDb
    );
    assert.equal(legacy.ok, false);
    if (!legacy.ok) assert.equal(legacy.code, "confirmation_required");
    assert.equal(mutated, false);
  } finally {
    if (previous === undefined) delete process.env.SA360_PPL_REPLACEMENT_ENABLED;
    else process.env.SA360_PPL_REPLACEMENT_ENABLED = previous;
  }
});
