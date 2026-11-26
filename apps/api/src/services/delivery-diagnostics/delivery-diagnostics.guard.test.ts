import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const SERVICE_DIR = new URL("./", import.meta.url);
const ROUTE = new URL("../../routes/admin-delivery-diagnostics.ts", import.meta.url);

function productionSources(): Array<{ name: string; text: string }> {
  const files = readdirSync(SERVICE_DIR).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
  const sources = files.map((name) => ({ name, text: readFileSync(new URL(name, SERVICE_DIR), "utf8") }));
  sources.push({ name: "routes/admin-delivery-diagnostics.ts", text: readFileSync(ROUTE, "utf8") });
  return sources;
}

function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, ""))
    .join("\n");
}

test("diagnostics sources contain no database write, queue mutation, provider call, or arbitrary SQL", () => {
  const forbidden: Array<[string, RegExp]> = [
    ["prisma create", /\.\w+\s*\.\s*(create|createMany|createManyAndReturn)\s*\(/],
    ["prisma update", /\.\w+\s*\.\s*(update|updateMany|upsert)\s*\(/],
    ["prisma delete", /\.\w+\s*\.\s*(delete|deleteMany)\s*\(/],
    ["unsafe raw sql", /\$(queryRawUnsafe|executeRawUnsafe)/],
    ["queue add", /\.\s*(add|addBulk|upsertJobScheduler|retryJobs|promoteJobs|obliterate|drain|clean|pause|resume|trimEvents)\s*\(/],
    ["worker", /new\s+Worker\s*\(/],
    ["network", /\bfetch\s*\(/],
    ["http client", /from\s+["'](axios|undici|node-fetch|googleapis|nodemailer)["']/],
    ["redis write", /\b(redis|redisClient|client|connection)\s*\.\s*(set|setex|del|incr|decr|lpush|rpush|sadd|srem|hset|hdel|zadd|zrem|expire|publish|eval|evalsha|flushdb|flushall)\s*\(/],
    ["delivery executor", /ghl-live-canary(?!-step-requirements)|ghl-delivery-adapter\.service|executeRecordedGhlDelivery|executeCompanySheetsDeliveryJob|deliverConfirmedAssociation/],
    ["mailer", /sendTransactionalEmail/],
    ["express write route", /\bapp\s*\.\s*(post|put|patch|delete)\s*\(/],
  ];
  for (const { name, text } of productionSources()) {
    const body = code(text);
    for (const [label, pattern] of forbidden) {
      assert.equal(pattern.test(body), false, `${name} must not contain: ${label}`);
    }
  }
});

test("diagnostics sources never select stored payload bodies or consumer fields", () => {
  const forbiddenColumns = [
    "rawPayloadJson",
    "normalizedPayloadJson",
    "requestRedactedJson",
    "valuesJson",
    "payloadJson",
    "deliveryResultJson",
    "duplicateRiskJson",
    "enrichmentMetadataJson",
    "sourceEmail",
    "sourcePhoneE164",
    "portalLoginEmail",
    "portalPasswordHash",
    "accessTokenEncrypted",
    "refreshTokenEncrypted",
  ];
  for (const { name, text } of productionSources()) {
    const body = code(text);
    for (const column of forbiddenColumns) {
      assert.equal(body.includes(column), false, `${name} must not reference ${column}`);
    }
  }
});

test("database access goes through the read-only transaction and every route is GET", () => {
  const route = code(readFileSync(ROUTE, "utf8"));
  assert.match(route, /withReadOnlyDb/);
  assert.match(route, /verifyAdminApiKey/);
  assert.equal(/\bapp\.(get)\(/.test(route), true);
  const readOnly = readFileSync(new URL("read-only.ts", SERVICE_DIR), "utf8");
  assert.match(readOnly, /SET TRANSACTION READ ONLY/);
  assert.match(readOnly, /SET LOCAL statement_timeout/);
  const summary = code(readFileSync(new URL("summary.ts", SERVICE_DIR), "utf8"));
  assert.equal(/deps\.db\.(?!\$transaction)\w+\./.test(summary), false);
});

test("queue reads create handles that do not write queue metadata", () => {
  const infra = readFileSync(new URL("infra-health.ts", SERVICE_DIR), "utf8");
  assert.match(infra, /skipMetasUpdate:\s*true/);
});
