import assert from "node:assert/strict";
import test from "node:test";

import { timingSafeStringEqual } from "./login.ts";

test("timingSafeStringEqual accepts a matching multibyte password and rejects a nonmatching one", () => {
  const password = "pässwörd-Δ-🔐";
  assert.notEqual(
    Buffer.from(password, "utf8").length,
    password.length,
    "fixture must have UTF-8 byte length !== JS string length (the old ba.length !== b.length bug)"
  );
  assert.equal(timingSafeStringEqual(password, password), true);
  assert.equal(timingSafeStringEqual(password, "pässwörd-Δ-🔐!"), false);
  assert.equal(timingSafeStringEqual(password, "password"), false);
});
