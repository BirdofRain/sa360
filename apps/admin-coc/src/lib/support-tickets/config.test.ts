import assert from "node:assert/strict";
import test from "node:test";

import { isSupportTicketsEnabled } from "./config.ts";

test("isSupportTicketsEnabled is false when unset", (t) => {
  const prev = process.env.NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED;
  t.after(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED;
    else process.env.NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED = prev;
  });
  delete process.env.NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED;
  assert.equal(isSupportTicketsEnabled(), false);
});

test("isSupportTicketsEnabled is true for truthy values", (t) => {
  const prev = process.env.NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED;
  t.after(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED;
    else process.env.NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED = prev;
  });
  process.env.NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED = "true";
  assert.equal(isSupportTicketsEnabled(), true);
});
