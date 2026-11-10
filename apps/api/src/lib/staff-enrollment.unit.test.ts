import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";

import { createStaffEnrollmentSecret } from "@sa360/shared/staff-enrollment";

import { bindStaffEnrollment } from "./staff-enrollment.js";

test("a database failure denies enrollment before any success result", async () => {
  const db = {
    $transaction: async () => {
      throw new Error("connect ECONNREFUSED");
    },
  } as unknown as PrismaClient;
  const result = await bindStaffEnrollment(
    {
      enrollmentSecret: createStaffEnrollmentSecret(),
      identity: { sub: "102938475610293847561", email: "ada.staff@example.com", emailVerified: true },
    },
    db
  );
  assert.deepEqual(result, { ok: false, code: "unavailable" });
});
