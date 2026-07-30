import assert from "node:assert/strict";
import test from "node:test";

import { assertExpectedDbHost, parseDatabaseTarget } from "./aged-inventory-bulk-db-guard.js";

test("parseDatabaseTarget sanitizes credentials", () => {
  const id = parseDatabaseTarget(
    "postgresql://sa360:super-secret@127.0.0.1:55432/sa360_inv_pilot?schema=public"
  );
  assert.equal(id.host, "127.0.0.1");
  assert.equal(id.port, "55432");
  assert.equal(id.database, "sa360_inv_pilot");
  assert.equal(id.sanitized.includes("super-secret"), false);
  assert.equal(id.sanitized, "postgres://sa360@127.0.0.1:55432/sa360_inv_pilot");
});

test("assertExpectedDbHost halts on mismatch", () => {
  assert.throws(
    () =>
      assertExpectedDbHost({
        databaseUrl: "postgresql://u:p@db.example.com:5432/sa360",
        expectedDbHost: "127.0.0.1:55432",
      }),
    /db_host_mismatch/
  );
});

test("assertExpectedDbHost accepts host:port", () => {
  const id = assertExpectedDbHost({
    databaseUrl: "postgresql://u:p@127.0.0.1:55432/sa360",
    expectedDbHost: "127.0.0.1:55432",
  });
  assert.equal(id.host, "127.0.0.1");
});
