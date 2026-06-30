import test, { after } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { adminRoutes } from "./admin.js";
import { prisma } from "../lib/db.js";
import { upsertLeadProof, upsertLeadVerificationResult } from "../repositories/lead-proof.repository.js";

const HEADER = "x-sa360-admin-key";
const ROUTE = "/admin/v1/coc/lead-fulfillment/overview";

async function buildAdminOnlyApp() {
  const app = Fastify({ logger: false });
  await app.register(adminRoutes, { prefix: "/admin/v1" });
  return app;
}

test("GET /admin/v1/coc/lead-fulfillment/overview → 401 when key wrong", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "secret-admin-key";
  const app = await buildAdminOnlyApp();
  const res = await app.inject({
    method: "GET",
    url: ROUTE,
    headers: { [HEADER]: "wrong" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("GET /admin/v1/coc/lead-fulfillment/overview → 200 with valid overview shape", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "secret-admin-key";
  const app = await buildAdminOnlyApp();
  const res = await app.inject({
    method: "GET",
    url: ROUTE,
    headers: { [HEADER]: "secret-admin-key" },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as {
    dataSource: string;
    kpis: unknown[];
    proofSummary: unknown[];
    recentIntake: unknown[];
    activity: unknown[];
    dataLimitations: string[];
  };
  assert.equal(body.dataSource, "lead_proof_vault");
  assert.ok(Array.isArray(body.kpis));
  assert.equal(body.kpis.length, 7);
  assert.ok(Array.isArray(body.proofSummary));
  assert.equal(body.proofSummary.length, 7);
  assert.ok(Array.isArray(body.recentIntake));
  assert.ok(Array.isArray(body.activity));
  assert.ok(body.dataLimitations.length > 0);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

const populatedLeadUid = `lf1-overview-route-${Date.now()}`;

test("GET /admin/v1/coc/lead-fulfillment/overview → includes populated proof vault row", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "secret-admin-key";

  await upsertLeadProof({
    leadUid: populatedLeadUid,
    sourceLane: "meta_lead_ads",
    sourcePlatform: "facebook",
    sourceType: "facebook_lead_form",
    proofStatus: "PROOF_ATTACHED",
    proofMissingReasons: [],
  });
  await upsertLeadVerificationResult({
    leadUid: populatedLeadUid,
    verificationStatus: "PASSED",
    duplicateStatus: "UNIQUE",
  });

  const app = await buildAdminOnlyApp();
  const res = await app.inject({
    method: "GET",
    url: ROUTE,
    headers: { [HEADER]: "secret-admin-key" },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as {
    kpis: Array<{ key: string; value: number }>;
    recentIntake: Array<{ leadUid: string }>;
  };
  assert.ok(body.kpis.find((k) => k.key === "leadsReceived")!.value >= 1);
  assert.ok(body.recentIntake.some((row) => row.leadUid === populatedLeadUid));
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

after(async () => {
  await prisma.leadVerificationResult.deleteMany({ where: { leadUid: populatedLeadUid } });
  await prisma.leadProof.deleteMany({ where: { leadUid: populatedLeadUid } });
});
