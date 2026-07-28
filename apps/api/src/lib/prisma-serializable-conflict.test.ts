import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@prisma/client";

import {
  INVENTORY_CHANGED_RETRY_REASON,
  isPrismaSerializableConflict,
} from "./prisma-serializable-conflict.js";

describe("isPrismaSerializableConflict", () => {
  it("detects Prisma P2034 / P2002 without exposing codes to callers", () => {
    const p2034 = new Prisma.PrismaClientKnownRequestError("write conflict", {
      code: "P2034",
      clientVersion: "test",
    });
    const p2002 = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002",
      clientVersion: "test",
    });
    assert.equal(isPrismaSerializableConflict(p2034), true);
    assert.equal(isPrismaSerializableConflict(p2002), true);
  });

  it("detects PostgreSQL 40001 / deadlock message shapes for classification only", () => {
    const raw40001 =
      "Invalid `prisma.$queryRaw()` invocation:\n\n\nRaw query failed. Code: `40001`. Message: `could not serialize access due to concurrent update`";
    assert.equal(isPrismaSerializableConflict(new Error(raw40001)), true);
    assert.equal(
      isPrismaSerializableConflict(
        new Prisma.PrismaClientKnownRequestError(raw40001, {
          code: "P2010",
          clientVersion: "test",
        })
      ),
      true
    );
    assert.equal(
      isPrismaSerializableConflict(new Error("deadlock detected")),
      true
    );
    assert.equal(isPrismaSerializableConflict(new Error("plain failure")), false);
    assert.equal(isPrismaSerializableConflict(null), false);
  });

  it("keeps domain retry reason free of SQLSTATE / Prisma internals", () => {
    assert.equal(INVENTORY_CHANGED_RETRY_REASON, "inventory_changed_retry");
    assert.doesNotMatch(INVENTORY_CHANGED_RETRY_REASON, /40001|P2034|serialize|Prisma/i);
  });
});
