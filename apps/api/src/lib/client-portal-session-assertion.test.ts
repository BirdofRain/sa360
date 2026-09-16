import assert from "node:assert/strict";
import test from "node:test";

import {
  createClientPortalAssertion,
  verifyClientPortalAssertion,
} from "@sa360/shared/client-portal-assertion";

test("portal tenant assertion is signed, short-lived, and tamper-evident", () => {
  const token = createClientPortalAssertion(
    { clientAccountId: "tenant-a", portalSessionEpoch: 7 },
    "server-only-api-key",
    1_000
  );
  assert.deepEqual(verifyClientPortalAssertion(token, "server-only-api-key", 1_001), {
    clientAccountId: "tenant-a",
    portalSessionEpoch: 7,
    iat: 1_000,
    exp: 1_060,
  });
  assert.equal(verifyClientPortalAssertion(token, "wrong-key", 1_001), null);
  assert.equal(verifyClientPortalAssertion(token, "server-only-api-key", 1_060)?.clientAccountId, "tenant-a");
  assert.equal(verifyClientPortalAssertion(token, "server-only-api-key", 1_061), null);
  assert.equal(verifyClientPortalAssertion("v1.abc.not-the-mac", "server-only-api-key", 1_001), null);
  assert.equal(verifyClientPortalAssertion(undefined, "server-only-api-key", 1_001), null);
  const [, body, sig] = token.split(".");
  const tampered = `v1.${Buffer.from(
    JSON.stringify({
      clientAccountId: "tenant-b",
      portalSessionEpoch: 7,
      iat: 1_000,
      exp: 1_060,
    })
  ).toString("base64url")}.${sig}`;
  assert.notEqual(body, tampered.split(".")[1]);
  assert.equal(verifyClientPortalAssertion(tampered, "server-only-api-key", 1_001), null);
});
