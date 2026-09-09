import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Mirrors `timingSafeStringEqual` in login.ts so the Unicode cases exercise
 * the same UTF-8 buffer-length pre-check. The source assertion below fails if
 * login.ts regresses to comparing `ba.length` with `b.length`.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

test("timingSafeStringEqual accepts a matching multibyte password and rejects a nonmatching one", () => {
  const loginSrc = fs.readFileSync(fileURLToPath(new URL("./login.ts", import.meta.url)), "utf8");
  assert.match(loginSrc, /if \(ba\.length !== bb\.length\) return false;/);
  assert.equal(/ba\.length !== b\.length/.test(loginSrc), false);

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
