import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { STAFF_SIGN_IN_URL } from "@sa360/shared/staff-sign-in-url";

test("the login page offers branded google sign-in and keeps the password fallback", () => {
  const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  assert.equal(STAFF_SIGN_IN_URL, "https://portal.lifeagentlaunch.com/staff/google/start");
  assert.match(source, /STAFF_SIGN_IN_URL/);
  assert.match(source, /Continue with Google/);
  assert.match(source, /LoginForm/);
  assert.equal(source.includes("when Google sign-in lands"), false);
  assert.equal(source.includes("Temporary password gate"), false);
});
