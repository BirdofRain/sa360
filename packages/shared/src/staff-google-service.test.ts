import assert from "node:assert/strict";
import test from "node:test";

import {
  STAFF_GOOGLE_SERVICE_HEADER,
  readStaffGoogleServiceSecret,
  staffGoogleServiceHeaderMatches,
} from "./staff-google-service.js";

const SERVICE = "staff-google-service-secret-32-characters";
const OTHER = "different-staff-service-secret-32-chars";

test("the staff service secret fails closed unless it is dedicated", () => {
  assert.equal(STAFF_GOOGLE_SERVICE_HEADER, "x-sa360-staff-google-service");
  assert.equal(readStaffGoogleServiceSecret({}), null);
  assert.equal(readStaffGoogleServiceSecret({ SA360_STAFF_GOOGLE_SERVICE_SECRET: "short-secret" }), null);
  assert.equal(
    readStaffGoogleServiceSecret({
      SA360_STAFF_GOOGLE_SERVICE_SECRET: SERVICE,
      ADMIN_API_KEY: SERVICE,
    }),
    null
  );
  assert.equal(
    readStaffGoogleServiceSecret({
      SA360_STAFF_GOOGLE_SERVICE_SECRET: SERVICE,
      CLIENT_PORTAL_API_KEY: SERVICE,
    }),
    null
  );
  assert.equal(
    readStaffGoogleServiceSecret({
      SA360_STAFF_GOOGLE_SERVICE_SECRET: SERVICE,
      SA360_STAFF_SESSION_SECRET: SERVICE,
    }),
    null
  );
  assert.equal(
    readStaffGoogleServiceSecret({
      SA360_STAFF_GOOGLE_SERVICE_SECRET: SERVICE,
      SA360_STAFF_ENROLLMENT_ISSUER_SECRET: SERVICE,
    }),
    null
  );
  assert.equal(readStaffGoogleServiceSecret({ SA360_STAFF_GOOGLE_SERVICE_SECRET: SERVICE, ADMIN_API_KEY: OTHER }), SERVICE);
  assert.equal(staffGoogleServiceHeaderMatches(SERVICE, SERVICE), true);
  assert.equal(staffGoogleServiceHeaderMatches("shared-admin-key", SERVICE), false);
});
