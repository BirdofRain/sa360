import test from "node:test";
import assert from "node:assert/strict";
import { clientChannelProfileSaveBodySchema } from "./client-channel-profile.schema.js";

test("accepts a valid partial save body", () => {
  const parsed = clientChannelProfileSaveBodySchema.safeParse({
    blueEnabled: true,
    defaultLeadChannel: "BLUE",
    aiProvider: "CLOSEBOT",
    closebotEnabled: true,
    textStartHour: 9,
    textEndHour: 21,
    writeMode: "simulate",
  });
  assert.equal(parsed.success, true);
});

test("rejects out-of-range hours", () => {
  const parsed = clientChannelProfileSaveBodySchema.safeParse({ textStartHour: 25 });
  assert.equal(parsed.success, false);
});

test("rejects unknown enum values", () => {
  const parsed = clientChannelProfileSaveBodySchema.safeParse({ aiProvider: "OPENAI" });
  assert.equal(parsed.success, false);
});

test("rejects unknown fields (strict)", () => {
  const parsed = clientChannelProfileSaveBodySchema.safeParse({ notAField: true });
  assert.equal(parsed.success, false);
});

test("accepts empty body (all defaults retained on merge)", () => {
  const parsed = clientChannelProfileSaveBodySchema.safeParse({});
  assert.equal(parsed.success, true);
});
