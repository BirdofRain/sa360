import test from "node:test";
import assert from "node:assert/strict";
import { isAdminCocPasswordConfigured } from "./admin-coc-auth.ts";

test("isAdminCocPasswordConfigured is false without ADMIN_COC_PASSWORD", (t) => {
  const original = process.env.ADMIN_COC_PASSWORD;
  const originalSecret = process.env.ADMIN_COC_SESSION_SECRET;
  t.after(() => {
    if (original === undefined) delete process.env.ADMIN_COC_PASSWORD;
    else process.env.ADMIN_COC_PASSWORD = original;
    if (originalSecret === undefined) delete process.env.ADMIN_COC_SESSION_SECRET;
    else process.env.ADMIN_COC_SESSION_SECRET = originalSecret;
  });

  delete process.env.ADMIN_COC_PASSWORD;
  assert.equal(isAdminCocPasswordConfigured(), false);

  process.env.ADMIN_COC_PASSWORD = "";
  assert.equal(isAdminCocPasswordConfigured(), false);

  process.env.ADMIN_COC_PASSWORD = "   ";
  assert.equal(isAdminCocPasswordConfigured(), false);

  process.env.ADMIN_COC_PASSWORD = "x";
  assert.equal(isAdminCocPasswordConfigured(), true);
});
