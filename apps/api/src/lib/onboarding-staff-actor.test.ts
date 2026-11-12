import assert from "node:assert/strict";
import test from "node:test";

import { signStaffAssertion, STAFF_ASSERTION_HEADER } from "@sa360/shared/staff-assertion";

import { prisma } from "./db.js";
import { acceptedOnboardingActor, resolveOnboardingStaffActor, SHARED_ADMIN_ACTOR } from "./onboarding-staff-actor.js";

const SECRET = "onboarding-actor-unit-secret-32chars";
const ADA = "c0123456789abcdefghijklmn";

test("shared admin attribution ignores browser actor labels", async () => {
  const resolved = await resolveOnboardingStaffActor(
    {
      "x-sa360-admin-actor": "Matt Manager",
      "x-sa360-staff-principal": ADA,
    },
    prisma,
    {}
  );
  assert.deepEqual(resolved, { ok: true, actor: SHARED_ADMIN_ACTOR });
  assert.equal(acceptedOnboardingActor(undefined), SHARED_ADMIN_ACTOR);
  assert.equal(acceptedOnboardingActor("Matt Manager"), null);
  assert.equal(acceptedOnboardingActor("ada@lifeagentlaunch.com"), null);
  assert.equal(acceptedOnboardingActor(ADA), ADA);
});

test("a present assertion that does not verify fails closed", async () => {
  const empty = await resolveOnboardingStaffActor({ [STAFF_ASSERTION_HEADER]: "" }, prisma, {
    SA360_STAFF_ASSERTION_SECRET: SECRET,
  });
  const many = await resolveOnboardingStaffActor({ [STAFF_ASSERTION_HEADER]: ["one", "two"] }, prisma, {
    SA360_STAFF_ASSERTION_SECRET: SECRET,
  });
  const forged = await resolveOnboardingStaffActor({ [STAFF_ASSERTION_HEADER]: "sa1.not-a-token.sig" }, prisma, {
    SA360_STAFF_ASSERTION_SECRET: SECRET,
  });
  assert.equal(empty.ok, false);
  assert.equal(many.ok, false);
  assert.equal(forged.ok, false);
  if (!empty.ok && !many.ok && !forged.ok) {
    assert.equal(empty.error, "staff_unauthenticated");
    assert.equal(many.error, "staff_unauthenticated");
    assert.equal(forged.error, "staff_unauthenticated");
  }
});

test("a verified assertion still fails closed when the principal cannot be confirmed", async () => {
  const token = signStaffAssertion({ staffPrincipalId: ADA, secret: SECRET }).token;
  const missing = await resolveOnboardingStaffActor({ [STAFF_ASSERTION_HEADER]: token }, fakeDb([]), {
    SA360_STAFF_ASSERTION_SECRET: SECRET,
  });
  const thrown = await resolveOnboardingStaffActor(
    { [STAFF_ASSERTION_HEADER]: token },
    fakeDb(new Error("db down")),
    { SA360_STAFF_ASSERTION_SECRET: SECRET }
  );
  assert.deepEqual(missing, { ok: false, statusCode: 403, error: "forbidden" });
  assert.deepEqual(thrown, { ok: false, statusCode: 403, error: "forbidden" });
});

function fakeDb(result: Array<{ id: string }> | Error) {
  return {
    $queryRaw: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as typeof prisma;
}
