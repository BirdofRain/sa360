import assert from "node:assert/strict";
import { test } from "node:test";

import { assertLocalDemoDatabaseUrl } from "./local-demo-database-url.js";

test("assertLocalDemoDatabaseUrl accepts localhost", () => {
  const url = assertLocalDemoDatabaseUrl("postgresql://sa360:secret@localhost:5432/sa360");
  assert.equal(url, "postgresql://sa360:secret@localhost:5432/sa360");
});

test("assertLocalDemoDatabaseUrl accepts 127.0.0.1", () => {
  const url = assertLocalDemoDatabaseUrl("postgresql://sa360:secret@127.0.0.1:5432/sa360");
  assert.match(url, /127\.0\.0\.1/);
});

test("assertLocalDemoDatabaseUrl rejects missing URL", () => {
  assert.throws(() => assertLocalDemoDatabaseUrl(undefined), /DATABASE_URL is required/);
  assert.throws(() => assertLocalDemoDatabaseUrl("   "), /DATABASE_URL is required/);
});

test("assertLocalDemoDatabaseUrl rejects malformed URL", () => {
  assert.throws(() => assertLocalDemoDatabaseUrl("not-a-url"), /not a valid URL/);
});

test("assertLocalDemoDatabaseUrl rejects remote hosts including DigitalOcean", () => {
  assert.throws(
    () =>
      assertLocalDemoDatabaseUrl(
        "postgresql://doadmin:secret@sa360-postgres-do-user-example.db.ondigitalocean.com:25060/defaultdb?sslmode=require"
      ),
    /must be localhost/
  );
  assert.throws(
    () => assertLocalDemoDatabaseUrl("postgresql://user:pass@db.example.com:5432/sa360"),
    /got db\.example\.com/
  );
});
