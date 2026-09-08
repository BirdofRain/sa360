import assert from "node:assert/strict";
import test from "node:test";

import {
  generatePublicClientAccountId,
  isGeneratedPublicClientAccountId,
} from "./client-account-id.js";

test("generated ids match the admin slug contract and are not browser-shaped", () => {
  const id = generatePublicClientAccountId(Buffer.alloc(10, 1));
  assert.equal(id, "avl01010101010101010101");
  assert.equal(isGeneratedPublicClientAccountId(id), true);
  assert.match(id, /^[a-z][a-z0-9_]*$/);
  assert.ok(id.length <= 80);
  assert.equal(isGeneratedPublicClientAccountId("acct_operator"), false);
  assert.equal(isGeneratedPublicClientAccountId("AVL01010101010101010101"), false);
});

test("successive ids differ when entropy differs", () => {
  const a = generatePublicClientAccountId(Buffer.from("abcdefghij"));
  const b = generatePublicClientAccountId(Buffer.from("klmnopqrst"));
  assert.notEqual(a, b);
});
