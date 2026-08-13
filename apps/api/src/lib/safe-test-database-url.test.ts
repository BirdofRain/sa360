import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertSafeTestDatabaseUrl,
  installTestDatabaseUrlLock,
  parseSafeTestDatabaseUrlIdentity,
  requireSafeTestDatabaseUrl,
  resolveTestPrismaDatabaseUrl,
} from "./safe-test-database-url.js";

test("accepts localhost + database name containing test", () => {
  const url = "postgresql://sa360:secret@localhost:5432/sa360_test";
  assert.equal(assertSafeTestDatabaseUrl(url), url);
  assert.equal(parseSafeTestDatabaseUrlIdentity(url).database, "sa360_test");
});

test("accepts 127.0.0.1 + test database", () => {
  const url = "postgresql://sa360:secret@127.0.0.1:5432/sa360_facets_claim_lock_test";
  assert.equal(assertSafeTestDatabaseUrl(url), url);
});

test("accepts ::1 + test database", () => {
  const url = "postgresql://sa360:secret@[::1]:5432/sa360_test";
  assert.equal(assertSafeTestDatabaseUrl(url), url);
  assert.equal(parseSafeTestDatabaseUrlIdentity(url).host, "::1");
});

test("rejects localhost + production-style database name", () => {
  assert.throws(
    () => assertSafeTestDatabaseUrl("postgresql://sa360:secret@localhost:5432/sa360"),
    /must identify a test-only database/
  );
  assert.throws(
    () => assertSafeTestDatabaseUrl("postgresql://sa360:secret@127.0.0.1:5432/defaultdb"),
    /must identify a test-only database/
  );
});

test("rejects DigitalOcean database hostname", () => {
  assert.throws(
    () =>
      assertSafeTestDatabaseUrl(
        "postgresql://doadmin:secret@sa360-postgres-do-user-example.db.ondigitalocean.com:25060/sa360_test?sslmode=require"
      ),
    /must be localhost/
  );
});

test("rejects generic remote hostname even with test db name", () => {
  assert.throws(
    () => assertSafeTestDatabaseUrl("postgresql://user:pass@db.example.com:5432/sa360_test"),
    /got db\.example\.com/
  );
});

test("rejects blank database name and non-postgres protocols", () => {
  assert.throws(
    () => assertSafeTestDatabaseUrl("postgresql://sa360:secret@localhost:5432/"),
    /database name is required/
  );
  assert.throws(
    () => assertSafeTestDatabaseUrl("mysql://sa360:secret@localhost:5432/sa360_test"),
    /protocol must be postgres/
  );
});

test("root/general DATABASE_URL alone cannot authorize mutation tests", () => {
  const previousTestUrl = process.env.SA360_TEST_DATABASE_URL;
  const previousDbUrl = process.env.DATABASE_URL;

  try {
    delete process.env.SA360_TEST_DATABASE_URL;
    process.env.DATABASE_URL =
      "postgresql://doadmin:secret@sa360-postgres-do-user-example.db.ondigitalocean.com:25060/defaultdb";

    const installed = installTestDatabaseUrlLock();
    assert.equal(installed.authorized, false);
    assert.equal(process.env.DATABASE_URL, undefined);

    assert.throws(() => requireSafeTestDatabaseUrl(), /SA360_TEST_DATABASE_URL is required/);
    assert.equal(resolveTestPrismaDatabaseUrl(undefined), undefined);
    assert.throws(
      () =>
        resolveTestPrismaDatabaseUrl(
          "postgresql://doadmin:secret@sa360-postgres-do-user-example.db.ondigitalocean.com:25060/defaultdb"
        ),
      /must be localhost/
    );
  } finally {
    if (previousTestUrl === undefined) delete process.env.SA360_TEST_DATABASE_URL;
    else process.env.SA360_TEST_DATABASE_URL = previousTestUrl;
    installTestDatabaseUrlLock();
    if (previousDbUrl !== undefined && !process.env.DATABASE_URL && process.env.SA360_TEST_DATABASE_URL) {
      // restored via SA360_TEST_DATABASE_URL
    }
  }
});

test("explicit SA360_TEST_DATABASE_URL authorizes only after validation", () => {
  const previousTestUrl = process.env.SA360_TEST_DATABASE_URL;
  try {
    process.env.SA360_TEST_DATABASE_URL =
      "postgresql://sa360:secret@127.0.0.1:5432/sa360_test";
    const installed = installTestDatabaseUrlLock();
    assert.equal(installed.authorized, true);
    assert.match(installed.sanitized ?? "", /127\.0\.0\.1:5432\/sa360_test/);
    assert.equal(
      process.env.DATABASE_URL,
      "postgresql://sa360:secret@127.0.0.1:5432/sa360_test"
    );
    assert.equal(
      requireSafeTestDatabaseUrl(),
      "postgresql://sa360:secret@127.0.0.1:5432/sa360_test"
    );
  } finally {
    if (previousTestUrl === undefined) delete process.env.SA360_TEST_DATABASE_URL;
    else process.env.SA360_TEST_DATABASE_URL = previousTestUrl;
    installTestDatabaseUrlLock();
  }
});
