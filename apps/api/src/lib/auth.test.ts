import test from "node:test";
import assert from "node:assert/strict";
import { isValidWebhookSecret } from "./auth.js";

test("isValidWebhookSecret: false when WEBHOOK_SECRET unset", () => {
  const prev = process.env.WEBHOOK_SECRET;
  delete process.env.WEBHOOK_SECRET;
  try {
    assert.equal(isValidWebhookSecret("any"), false);
    assert.equal(isValidWebhookSecret(undefined), false);
  } finally {
    if (prev !== undefined) process.env.WEBHOOK_SECRET = prev;
  }
});

test("isValidWebhookSecret: false when incoming missing or empty", () => {
  const prev = process.env.WEBHOOK_SECRET;
  process.env.WEBHOOK_SECRET = "secret-key";
  try {
    assert.equal(isValidWebhookSecret(undefined), false);
    assert.equal(isValidWebhookSecret(""), false);
    assert.equal(isValidWebhookSecret("   "), false);
  } finally {
    if (prev === undefined) delete process.env.WEBHOOK_SECRET;
    else process.env.WEBHOOK_SECRET = prev;
  }
});

test("isValidWebhookSecret: false when wrong secret", () => {
  const prev = process.env.WEBHOOK_SECRET;
  process.env.WEBHOOK_SECRET = "expected";
  try {
    assert.equal(isValidWebhookSecret("wrong"), false);
  } finally {
    if (prev === undefined) delete process.env.WEBHOOK_SECRET;
    else process.env.WEBHOOK_SECRET = prev;
  }
});

test("isValidWebhookSecret: true when both match", () => {
  const prev = process.env.WEBHOOK_SECRET;
  process.env.WEBHOOK_SECRET = "shared-secret";
  try {
    assert.equal(isValidWebhookSecret("shared-secret"), true);
  } finally {
    if (prev === undefined) delete process.env.WEBHOOK_SECRET;
    else process.env.WEBHOOK_SECRET = prev;
  }
});
