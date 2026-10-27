import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@prisma/client";

import { classifyCapturedTestReservationError } from "./onboarding-test-store.js";

test("only a requestId unique conflict is a duplicate reservation", () => {
  const requestId = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["requestId"] },
  });
  assert.equal(classifyCapturedTestReservationError(requestId), "duplicate_request");

  const audit = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: "ClientOnboardingV2AuditEvent_requestId_key" },
  });
  assert.equal(classifyCapturedTestReservationError(audit), "duplicate_request");

  const otherKey = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["idempotencyKey"] },
  });
  assert.equal(classifyCapturedTestReservationError(otherKey), "fail_closed");

  const unnamed = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: {},
  });
  assert.equal(classifyCapturedTestReservationError(unnamed), "fail_closed");
  assert.equal(classifyCapturedTestReservationError(new Error("connection reset")), "fail_closed");
});
