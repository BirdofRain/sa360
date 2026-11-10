import assert from "node:assert/strict";
import test from "node:test";

import { parseStaffGoogleEnrollRedirectUri, parseStaffGoogleRedirectUri } from "./staff-google-oidc.js";
import {
  STAFF_ENROLLMENT_TTL_SECONDS,
  createStaffEnrollmentSecret,
  readStaffEnrollmentIssuerSecret,
  staffEnrollmentSecretDigest,
} from "./staff-enrollment.js";

const ISSUER = "staff-enrollment-issuer-secret-32-chars";
const OTHER = "different-enrollment-issuer-secret-32";

test("an enrollment secret is stored only as a digest and expires quickly", () => {
  const secret = createStaffEnrollmentSecret();
  const digest = staffEnrollmentSecretDigest(secret);
  assert.equal(secret.length, 43);
  assert.equal(digest?.length, 64);
  assert.notEqual(digest, secret);
  assert.equal(digest?.includes(secret), false);
  assert.equal(staffEnrollmentSecretDigest("short"), null);
  assert.equal(STAFF_ENROLLMENT_TTL_SECONDS, 15 * 60);
});

test("the enrollment issuer secret is not the admin password or the staff service secret", () => {
  assert.equal(readStaffEnrollmentIssuerSecret({}), null);
  assert.equal(readStaffEnrollmentIssuerSecret({ SA360_STAFF_ENROLLMENT_ISSUER_SECRET: "short-secret" }), null);
  assert.equal(
    readStaffEnrollmentIssuerSecret({
      SA360_STAFF_ENROLLMENT_ISSUER_SECRET: ISSUER,
      ADMIN_COC_PASSWORD: ISSUER,
    }),
    null
  );
  assert.equal(
    readStaffEnrollmentIssuerSecret({
      SA360_STAFF_ENROLLMENT_ISSUER_SECRET: ISSUER,
      SA360_STAFF_GOOGLE_SERVICE_SECRET: ISSUER,
    }),
    null
  );
  assert.equal(readStaffEnrollmentIssuerSecret({ SA360_STAFF_ENROLLMENT_ISSUER_SECRET: ISSUER, ADMIN_COC_PASSWORD: OTHER }), ISSUER);
});

test("login and enrollment redirect URIs do not substitute for each other", () => {
  const login = "https://admin.example/staff/google/callback";
  const enroll = "https://admin.example/staff/google/enroll/callback";
  assert.equal(parseStaffGoogleRedirectUri(login), login);
  assert.equal(parseStaffGoogleRedirectUri(enroll), null);
  assert.equal(parseStaffGoogleEnrollRedirectUri(enroll), enroll);
  assert.equal(parseStaffGoogleEnrollRedirectUri(login), null);
});
