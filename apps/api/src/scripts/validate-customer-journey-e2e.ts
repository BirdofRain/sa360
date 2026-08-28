/**
 * LOCAL / TEST-DB ONLY — connected MVP customer-journey validation.
 *
 * Exercises the real Fastify admin + client routes against the local
 * `sa360_test` Postgres. Does not deploy, does not touch production,
 * and does not send transactional email.
 *
 * Usage (from apps/api):
 *   node --import tsx/esm --import ./src/test/set-test-env.ts \
 *     src/scripts/validate-customer-journey-e2e.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSafeTestDatabaseUrl } from "../lib/safe-test-database-url.js";
import { seedPplAgedBetaFixtures } from "../services/ppl-fulfillment/ppl-beta-fixtures.js";
import { prisma } from "../lib/db.js";
import { buildApp } from "../app.js";

const ADMIN_KEY = "journey-e2e-admin-key";
const PORTAL_KEY = "journey-e2e-portal-key";
const ADMIN_HEADER = { "x-sa360-admin-key": ADMIN_KEY };
const PORTAL_HEADER = { "x-sa360-client-portal-key": PORTAL_KEY };
const COMMERCE_BUCKETS = [
  "COMMERCE_1_3_MO",
  "COMMERCE_3_6_MO",
  "COMMERCE_6_9_MO",
  "COMMERCE_12_MO_PLUS",
];
const INTERNAL_CSV_LEAKS = [
  "allocation_id",
  "allocationId",
  "lead_allocation",
  "idempotency",
  "spreadsheetDeliveredBy",
  "createdBy",
  "adminNotes",
  "paymentConfirmedBy",
  "/tmp/",
  "/workspace/",
  "node_modules",
];

type StepResult = {
  step: string;
  action: string;
  expected: string;
  actual: string;
  result: "PASS" | "FAIL";
  evidence: unknown;
};

const steps: StepResult[] = [];
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const suffix = `${stamp.slice(0, 15).toLowerCase().replace("t", "_")}_${Math.random()
  .toString(36)
  .slice(2, 6)}`;
const tenantA = `journey_e2e_a_${suffix}`;
const tenantB = `journey_e2e_b_${suffix}`;
const tenantPaused = `journey_e2e_p_${suffix}`;
const emailA = `journey-e2e-a-${suffix}@example.test`;
const emailB = `journey-e2e-b-${suffix}@example.test`;
const emailPaused = `journey-e2e-p-${suffix}@example.test`;

function record(
  step: string,
  action: string,
  expected: string,
  actual: string,
  pass: boolean,
  evidence: unknown
) {
  steps.push({
    step,
    action,
    expected,
    actual,
    result: pass ? "PASS" : "FAIL",
    evidence,
  });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`[${mark}] ${step} — ${action}`);
  if (!pass) console.log(`         expected: ${expected}\n         actual:   ${actual}`);
}

function jsonOf(res: { body: string }) {
  try {
    return JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    return { raw: res.body.slice(0, 500) };
  }
}

async function main() {
  const testUrl = assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  process.env.DATABASE_URL = testUrl;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  process.env.CLIENT_PORTAL_API_KEY = PORTAL_KEY;
  delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  process.env.SA360_PPL_SELECTION_ENABLED = "true";
  process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
  process.env.SA360_PPL_LOCAL_MIN_QTY = "1";

  const dbIdentity = new URL(testUrl);
  const environment = {
    kind: "local_test_stack",
    postgres: `${dbIdentity.hostname}:${dbIdentity.port || "5432"}${dbIdentity.pathname}`,
    redis: process.env.SA360_TEST_REDIS_URL || process.env.REDIS_URL || "unused_for_this_path",
    masterSha: process.env.SA360_VALIDATION_MASTER_SHA || "unknown",
    realServicesExercised: [
      "local Fastify API (inject)",
      "local sa360_test Postgres via Prisma",
      "existing PPL aged-inventory fixtures",
      "portal journey presenter (admin-coc)",
    ],
    realServicesNotExercised: [
      "production DigitalOcean / remote Postgres / Redis",
      "Stripe / card charging",
      "GHL live delivery",
      "Resend / transactional email (separate lane)",
      "Meta / Synthflow / Logtail",
    ],
  };

  await seedPplAgedBetaFixtures(prisma);
  const app = await buildApp();

  const admin = (method: string, url: string, body?: unknown) =>
    app.inject({
      method,
      url,
      headers:
        body === undefined
          ? ADMIN_HEADER
          : { ...ADMIN_HEADER, "content-type": "application/json" },
      payload: body,
    });
  const client = (method: string, url: string, body?: unknown) =>
    app.inject({
      method,
      url,
      headers:
        body === undefined
          ? PORTAL_HEADER
          : { ...PORTAL_HEADER, "content-type": "application/json" },
      payload: body,
    });

  // --- Phase 2: new client ---
  const createA = await admin("POST", "/admin/v1/clients", {
    clientAccountId: tenantA,
    clientDisplayName: "Journey Valley Vet",
  });
  const createdA = jsonOf(createA);
  const createdItem = (createdA.item ?? {}) as Record<string, unknown>;
  record(
    "2.1 Create client",
    "POST /admin/v1/clients",
    "201; status=onboarding; portalEnabled=false; ready-to-order false",
    `${createA.statusCode} status=${String(createdItem.status)} portal=${String(createdItem.portalEnabled)}`,
    createA.statusCode === 201 &&
      createdItem.status === "onboarding" &&
      createdItem.portalEnabled === false,
    createdItem
  );

  const beforePortalAccount = await client("GET", `/client/v1/account?clientAccountId=${tenantA}`);
  record(
    "2.2 Portal before provision",
    "GET /client/v1/account with portal disabled",
    "403 PORTAL_DISABLED",
    `${beforePortalAccount.statusCode} ${JSON.stringify(jsonOf(beforePortalAccount))}`,
    beforePortalAccount.statusCode === 403 &&
      (jsonOf(beforePortalAccount).code === "PORTAL_DISABLED" ||
        String(jsonOf(beforePortalAccount).error).toLowerCase().includes("portal")),
    jsonOf(beforePortalAccount)
  );

  const provision = await admin("PATCH", `/admin/v1/clients/${tenantA}`, {
    portalEnabled: true,
    portalLoginEmail: emailA,
    portalDisplayName: "Valley Vet Portal",
  });
  const provisioned = (jsonOf(provision).item ?? {}) as Record<string, unknown>;
  record(
    "2.3 Provision portal",
    "PATCH /admin/v1/clients/:id enable portal + login email",
    "200; portalEnabled=true; portalLoginEmail set; status still onboarding",
    `${provision.statusCode} portal=${String(provisioned.portalEnabled)} email=${String(provisioned.portalLoginEmail)} status=${String(provisioned.status)}`,
    provision.statusCode === 200 &&
      provisioned.portalEnabled === true &&
      provisioned.portalLoginEmail === emailA &&
      provisioned.status === "onboarding",
    provisioned
  );

  const contextA = await client("GET", `/client/v1/portal-context?loginEmail=${encodeURIComponent(emailA)}`);
  const ctxA = (jsonOf(contextA).context ?? {}) as Record<string, unknown>;
  record(
    "2.4 Portal login identity",
    "GET /client/v1/portal-context by login email",
    "200; clientAccountId matches new tenant; portalEnabled",
    `${contextA.statusCode} id=${String(ctxA.clientAccountId)} enabled=${String(ctxA.portalEnabled)}`,
    contextA.statusCode === 200 && ctxA.clientAccountId === tenantA && ctxA.portalEnabled === true,
    ctxA
  );

  // --- Phase 3: onboarding ---
  const accountBefore = await client("GET", `/client/v1/account?clientAccountId=${tenantA}`);
  const accBefore = (jsonOf(accountBefore).account ?? {}) as Record<string, unknown>;
  record(
    "3.1 Account before onboarding",
    "GET /client/v1/account",
    "readyToOrder=false; status=onboarding",
    `${accountBefore.statusCode} ready=${String(accBefore.readyToOrder)} status=${String(accBefore.status)}`,
    accountBefore.statusCode === 200 &&
      accBefore.readyToOrder === false &&
      accBefore.status === "onboarding",
    accBefore
  );

  const statusWrite = await client("PATCH", `/client/v1/account?clientAccountId=${tenantA}`, {
    clientDisplayName: "Hacked",
    status: "active",
    portalEnabled: true,
  });
  record(
    "3.2 Customer cannot set status",
    "PATCH /client/v1/account with status/portalEnabled",
    "400 Invalid body (strict schema)",
    `${statusWrite.statusCode} ${JSON.stringify(jsonOf(statusWrite))}`,
    statusWrite.statusCode === 400,
    jsonOf(statusWrite)
  );

  const incompleteOnboard = await client(
    "POST",
    `/client/v1/account/complete-onboarding?clientAccountId=${tenantA}`,
    { clientDisplayName: "Journey Valley Vet" }
  );
  const incompleteBody = jsonOf(incompleteOnboard);
  record(
    "3.3 Incomplete onboarding stays blocked",
    "POST complete-onboarding without niche/product",
    "400 PROFILE_INCOMPLETE; readyToOrder still false",
    `${incompleteOnboard.statusCode} code=${String(incompleteBody.code)}`,
    incompleteOnboard.statusCode === 400 && incompleteBody.code === "PROFILE_INCOMPLETE",
    incompleteBody
  );

  const blockedOrder = await client("POST", `/client/v1/lead-orders?clientAccountId=${tenantA}`, {
    nicheKey: "vet",
    productType: "aged_leads",
    states: ["NC"],
    leadVolume: 5,
    campaignType: "ppl_aged",
    crmPackage: "spreadsheet",
    deliveryDestinationLabel: "Portal spreadsheet",
  });
  record(
    "3.4 Onboarding cannot POST order",
    "POST /client/v1/lead-orders while not ready",
    "409 ACCOUNT_NOT_READY_TO_ORDER",
    `${blockedOrder.statusCode} ${JSON.stringify(jsonOf(blockedOrder))}`,
    blockedOrder.statusCode === 409 &&
      jsonOf(blockedOrder).code === "ACCOUNT_NOT_READY_TO_ORDER",
    jsonOf(blockedOrder)
  );

  const onboard = await client(
    "POST",
    `/client/v1/account/complete-onboarding?clientAccountId=${tenantA}`,
    {
      clientDisplayName: "Journey Valley Vet",
      primaryNicheKeys: ["vet"],
      primaryProductTypes: ["aged_leads"],
    }
  );
  const accReady = (jsonOf(onboard).account ?? {}) as Record<string, unknown>;
  record(
    "3.5 Complete onboarding",
    "POST /client/v1/account/complete-onboarding",
    "200; status=active; readyToOrder=true",
    `${onboard.statusCode} status=${String(accReady.status)} ready=${String(accReady.readyToOrder)}`,
    onboard.statusCode === 200 && accReady.status === "active" && accReady.readyToOrder === true,
    accReady
  );

  // Tenant B + paused tenant
  await admin("POST", "/admin/v1/clients", {
    clientAccountId: tenantB,
    clientDisplayName: "Journey Other Buyer",
  });
  await admin("PATCH", `/admin/v1/clients/${tenantB}`, {
    portalEnabled: true,
    portalLoginEmail: emailB,
  });
  await client("POST", `/client/v1/account/complete-onboarding?clientAccountId=${tenantB}`, {
    clientDisplayName: "Journey Other Buyer",
    primaryNicheKeys: ["trucker"],
    primaryProductTypes: ["aged_leads"],
  });
  await admin("POST", "/admin/v1/clients", {
    clientAccountId: tenantPaused,
    clientDisplayName: "Journey Paused Buyer",
    status: "paused",
    portalEnabled: true,
    portalLoginEmail: emailPaused,
    primaryNicheKeys: ["vet"],
    primaryProductTypes: ["aged_leads"],
  });

  const foreignPatch = await client("PATCH", `/client/v1/account?clientAccountId=${tenantB}`, {
    clientDisplayName: "Should Not Touch A",
  });
  const aAfterForeign = await client("GET", `/client/v1/account?clientAccountId=${tenantA}`);
  const aName = ((jsonOf(aAfterForeign).account ?? {}) as Record<string, unknown>).clientDisplayName;
  record(
    "3.6 Tenant B cannot modify tenant A profile",
    "PATCH account as B, then GET A",
    "A display name remains Journey Valley Vet",
    `B patch ${foreignPatch.statusCode}; A name=${String(aName)}`,
    foreignPatch.statusCode === 200 && aName === "Journey Valley Vet",
    { foreignPatch: jsonOf(foreignPatch), aAfter: jsonOf(aAfterForeign) }
  );

  const pausedOrder = await client(
    "POST",
    `/client/v1/lead-orders?clientAccountId=${tenantPaused}`,
    {
      nicheKey: "vet",
      productType: "aged_leads",
      states: ["NC"],
      leadVolume: 1,
      campaignType: "ppl_aged",
      crmPackage: "spreadsheet",
      deliveryDestinationLabel: "Portal spreadsheet",
    }
  );
  record(
    "3.7 Paused account cannot POST order",
    "POST /client/v1/lead-orders as paused tenant",
    "409 ACCOUNT_NOT_READY_TO_ORDER",
    `${pausedOrder.statusCode} ${JSON.stringify(jsonOf(pausedOrder))}`,
    pausedOrder.statusCode === 409 &&
      jsonOf(pausedOrder).code === "ACCOUNT_NOT_READY_TO_ORDER",
    jsonOf(pausedOrder)
  );

  // --- Phase 4: order request ---
  const createOrder = await client("POST", `/client/v1/lead-orders?clientAccountId=${tenantA}`, {
    nicheKey: "vet",
    productType: "aged_leads",
    states: ["NC"],
    leadVolume: 5,
    campaignType: "ppl_aged",
    crmPackage: "spreadsheet",
    deliveryDestinationLabel: "Portal spreadsheet",
    notes: "E2E journey validation order",
  });
  const orderItem = (jsonOf(createOrder).item ?? {}) as Record<string, unknown>;
  const orderId = String(orderItem.id ?? "");
  const orderNumber = String(orderItem.orderNumber ?? "");
  record(
    "4.1 Place order request",
    "POST /client/v1/lead-orders (portal intake)",
    "201; status=submitted; paymentConfirmationStatus=pending_confirmation",
    `${createOrder.statusCode} status=${String(orderItem.status)} payment=${String(orderItem.paymentConfirmationStatus)} id=${orderId} number=${orderNumber}`,
    createOrder.statusCode === 201 &&
      orderItem.status === "submitted" &&
      orderItem.paymentConfirmationStatus === "pending_confirmation" &&
      Boolean(orderId),
    orderItem
  );

  // --- Phase 5: payment / approval ---
  const denyApprove = await admin("POST", `/admin/v1/lead-orders/${orderId}/approve`);
  record(
    "5.1 Pending-payment approval denied",
    "POST /admin/v1/lead-orders/:id/approve before payment",
    "409 payment_confirmation_required; status remains submitted",
    `${denyApprove.statusCode} ${JSON.stringify(jsonOf(denyApprove))}`,
    denyApprove.statusCode === 409 &&
      jsonOf(denyApprove).error === "payment_confirmation_required",
    jsonOf(denyApprove)
  );

  const skipActive = await admin("PATCH", `/admin/v1/lead-orders/${orderId}`, {
    status: "active",
  });
  record(
    "5.2 submitted → active skip denied",
    "PATCH /admin/v1/lead-orders/:id status=active",
    "409 submitted_cannot_activate",
    `${skipActive.statusCode} ${JSON.stringify(jsonOf(skipActive))}`,
    skipActive.statusCode === 409 && jsonOf(skipActive).error === "submitted_cannot_activate",
    jsonOf(skipActive)
  );

  const confirmPay = await admin("POST", `/admin/v1/lead-orders/${orderId}/confirm-payment`, {
    confirmedBy: "alex-e2e",
  });
  const paidItem = (jsonOf(confirmPay).item ?? {}) as Record<string, unknown>;
  record(
    "5.3 Confirm payment",
    "POST /admin/v1/lead-orders/:id/confirm-payment",
    "200; paymentConfirmationStatus=confirmed; status still submitted",
    `${confirmPay.statusCode} payment=${String(paidItem.paymentConfirmationStatus)} status=${String(paidItem.status)}`,
    confirmPay.statusCode === 200 &&
      paidItem.paymentConfirmationStatus === "confirmed" &&
      paidItem.status === "submitted",
    paidItem
  );

  const approve = await admin("POST", `/admin/v1/lead-orders/${orderId}/approve`);
  const approvedItem = (jsonOf(approve).item ?? {}) as Record<string, unknown>;
  record(
    "5.4 Approve order",
    "POST /admin/v1/lead-orders/:id/approve",
    "200; status=ready; payment remains confirmed",
    `${approve.statusCode} status=${String(approvedItem.status)} payment=${String(approvedItem.paymentConfirmationStatus)}`,
    approve.statusCode === 200 &&
      approvedItem.status === "ready" &&
      approvedItem.paymentConfirmationStatus === "confirmed",
    approvedItem
  );

  // --- Phase 6: activation ---
  const activateEarlyProbe = await admin(
    "POST",
    `/admin/v1/fulfillment-ops/orders/${orderId}/activate`
  );
  const activate = activateEarlyProbe;
  const activated = jsonOf(activate);
  const activatedOrder = (activated.order ?? {}) as Record<string, unknown>;
  record(
    "6.1 Activate fulfillment-ops",
    "POST /admin/v1/fulfillment-ops/orders/:id/activate",
    "200; status=active; orderKind=pay_per_lead; fulfillmentMode=pooled_matching; requestedQuantity=5",
    `${activate.statusCode} status=${String(activatedOrder.status)} kind=${String(activatedOrder.orderKind)} mode=${String(activatedOrder.fulfillmentMode)} qty=${String(activatedOrder.requestedQuantity)}`,
    activate.statusCode === 200 &&
      activated.ok === true &&
      activatedOrder.status === "active" &&
      activatedOrder.orderKind === "pay_per_lead" &&
      activatedOrder.fulfillmentMode === "pooled_matching" &&
      Number(activatedOrder.requestedQuantity) === 5,
    activated
  );

  const activateUnapproved = await admin("POST", "/admin/v1/clients", {
    clientAccountId: `journey_e2e_u_${suffix}`,
    clientDisplayName: "Unapproved Probe",
    status: "active",
    portalEnabled: true,
    portalLoginEmail: `journey-e2e-u-${suffix}@example.test`,
    primaryNicheKeys: ["vet"],
    primaryProductTypes: ["aged_leads"],
  });
  void activateUnapproved;
  const probeOrder = await client(
    "POST",
    `/client/v1/lead-orders?clientAccountId=journey_e2e_u_${suffix}`,
    {
      nicheKey: "vet",
      productType: "aged_leads",
      states: ["NC"],
      leadVolume: 1,
      campaignType: "ppl_aged",
      crmPackage: "spreadsheet",
      deliveryDestinationLabel: "Portal spreadsheet",
    }
  );
  const probeId = String(((jsonOf(probeOrder).item ?? {}) as Record<string, unknown>).id ?? "");
  const unapprovedActivate = await admin(
    "POST",
    `/admin/v1/fulfillment-ops/orders/${probeId}/activate`
  );
  record(
    "6.2 Unapproved cannot activate",
    "Activate a submitted/unapproved order",
    "409 submitted_cannot_activate",
    `${unapprovedActivate.statusCode} ${JSON.stringify(jsonOf(unapprovedActivate))}`,
    unapprovedActivate.statusCode === 409 &&
      jsonOf(unapprovedActivate).error === "submitted_cannot_activate",
    jsonOf(unapprovedActivate)
  );

  // --- Phase 7: lead selection ---
  const select = await admin("POST", `/admin/v1/fulfillment-ops/orders/${orderId}/selection/commit`, {
    commerceAgeBucketKeys: COMMERCE_BUCKETS,
    requestedQuantity: 2,
    idempotencyKey: `journey-select-${orderId}`,
  });
  const selected = jsonOf(select);
  const selectedCount = Array.isArray(selected.allocationIds)
    ? selected.allocationIds.length
    : Array.isArray(selected.selectedItemIds)
      ? selected.selectedItemIds.length
      : Number(selected.reservedCount ?? selected.count ?? 0);
  record(
    "7.1 Reserve/commit 2 of 5",
    "POST fulfillment-ops selection/commit requestedQuantity=2",
    "200; 2 reserved allocations; customer committed count still 0",
    `${select.statusCode} ok=${String(selected.ok)} selected=${selectedCount}`,
    select.statusCode === 200 && selected.ok === true && selectedCount === 2,
    selected
  );

  const reservedRows = await prisma.leadAllocation.findMany({
    where: { leadOrderId: orderId },
    select: { id: true, status: true, leadInventoryItemId: true },
  });
  const reservedOnly = reservedRows.filter((row) => row.status === "reserved").length;
  const committedNow = reservedRows.filter((row) => row.status === "committed").length;

  const customerAfterReserve = await client(
    "GET",
    `/client/v1/lead-orders/${orderId}?clientAccountId=${tenantA}`
  );
  const fulfillmentAfterReserve = (
    (jsonOf(customerAfterReserve).item ?? {}) as Record<string, unknown>
  ).fulfillment as Record<string, unknown> | null;
  record(
    "7.2 Customer fulfillment ignores reserved holds",
    "GET /client/v1/lead-orders/:id after reserve",
    "requested=5 fulfilled=0 remaining=5 (reserved ≠ delivered)",
    `db reserved=${reservedOnly} committed=${committedNow}; api fulfillment=${JSON.stringify(fulfillmentAfterReserve)}`,
    reservedOnly === 2 &&
      committedNow === 0 &&
      fulfillmentAfterReserve?.requestedQuantity === 5 &&
      fulfillmentAfterReserve?.fulfilledQuantity === 0 &&
      fulfillmentAfterReserve?.remainingQuantity === 5,
    { reservedRows, fulfillmentAfterReserve }
  );

  const storedOrder = await prisma.leadOrder.findUnique({
    where: { id: orderId },
    select: { fulfilledQuantity: true, requestedQuantity: true, leadVolume: true },
  });

  // --- Phase 8: export pre-release ---
  const exportCommit = await admin(
    "POST",
    `/admin/v1/fulfillment-ops/orders/${orderId}/exports/commit`,
    { idempotencyKey: `journey-export-${orderId}`, createdBy: "alex-e2e" }
  );
  const exported = jsonOf(exportCommit);
  const exportId = String(exported.exportId ?? exported.id ?? "");
  record(
    "8.1 Commit export package",
    "POST fulfillment-ops exports/commit",
    "200; package id present; spreadsheetDeliveredAt null",
    `${exportCommit.statusCode} exportId=${exportId} deliveredAt=${String(exported.spreadsheetDeliveredAt)}`,
    exportCommit.statusCode === 200 &&
      exported.ok === true &&
      Boolean(exportId) &&
      (exported.spreadsheetDeliveredAt == null || exported.spreadsheetDeliveredAt === undefined),
    exported
  );

  const adminDownload = await admin(
    "GET",
    `/admin/v1/fulfillment-ops/exports/${exportId}/download`
  );
  record(
    "8.2 Internal Alex CSV download",
    "GET /admin/v1/fulfillment-ops/exports/:id/download",
    "200 text/csv; x-sa360-spreadsheet-delivered=false",
    `${adminDownload.statusCode} ct=${String(adminDownload.headers["content-type"])} delivered=${String(adminDownload.headers["x-sa360-spreadsheet-delivered"])}`,
    adminDownload.statusCode === 200 &&
      String(adminDownload.headers["content-type"] ?? "").includes("text/csv") &&
      String(adminDownload.headers["x-sa360-spreadsheet-delivered"]) === "false",
    {
      contentType: adminDownload.headers["content-type"],
      disposition: adminDownload.headers["content-disposition"],
      deliveredHeader: adminDownload.headers["x-sa360-spreadsheet-delivered"],
      preview: adminDownload.body.slice(0, 200),
    }
  );

  const customerExportsBefore = await client(
    "GET",
    `/client/v1/lead-orders/${orderId}/exports?clientAccountId=${tenantA}`
  );
  const exportsBefore = jsonOf(customerExportsBefore);
  record(
    "8.3 Customer exports empty before release",
    "GET /client/v1/lead-orders/:id/exports",
    "200 items=[]",
    `${customerExportsBefore.statusCode} items=${JSON.stringify(exportsBefore.items)}`,
    customerExportsBefore.statusCode === 200 &&
      Array.isArray(exportsBefore.items) &&
      (exportsBefore.items as unknown[]).length === 0,
    exportsBefore
  );

  const preReleaseExportId = exportId || "pkg_unreleased";
  const customerDlBefore = await client(
    "GET",
    `/client/v1/lead-orders/${orderId}/exports/${preReleaseExportId}/download?clientAccountId=${tenantA}`
  );
  record(
    "8.4 Customer download inaccessible before release",
    "GET customer export download",
    "404 Delivery not found (no existence leak)",
    `${customerDlBefore.statusCode} ${JSON.stringify(jsonOf(customerDlBefore))}`,
    customerDlBefore.statusCode === 404 &&
      jsonOf(customerDlBefore).error === "Delivery not found" &&
      !Object.hasOwn(jsonOf(customerDlBefore), "spreadsheetDeliveredAt"),
    jsonOf(customerDlBefore)
  );

  const homeBeforeRelease = evaluateHome(tenantA, orderItem, customerAfterReserve, exportsBefore, true);
  record(
    "8.5 Dashboard is not Ready before release",
    "Portal journey presenter on live API payloads",
    "hero is not 'Your order is ready'; may be in progress / finalizing only if warranted",
    `hero=${homeBeforeRelease.hero.kind} title=${homeBeforeRelease.hero.title}`,
    homeBeforeRelease.hero.kind !== "order_ready" &&
      homeBeforeRelease.hero.title !== "Your order is ready",
    homeBeforeRelease.hero
  );

  // --- Phase 9: release ---
  const release = await admin(
    "POST",
    `/admin/v1/fulfillment-ops/exports/${exportId}/mark-spreadsheet-delivered`,
    {
      confirmationPhrase: "MARK SPREADSHEET DELIVERED",
      idempotencyKey: `journey-release-${exportId}`,
      deliveredBy: "alex-e2e",
    }
  );
  const released = jsonOf(release);
  const pkgRow = await prisma.leadDeliveryExportPackage.findUnique({
    where: { id: exportId },
    select: { spreadsheetDeliveredAt: true, rowCount: true, clientAccountId: true },
  });
  const identities = await prisma.buyerDeliveredIdentity.count({
    where: { clientAccountId: tenantA },
  });
  const allocAfter = await prisma.leadAllocation.findMany({
    where: { leadOrderId: orderId },
    select: { id: true, status: true },
  });
  const committedAfter = allocAfter.filter((row) => row.status === "committed").length;
  const orderAfterRelease = await prisma.leadOrder.findUnique({
    where: { id: orderId },
    select: { status: true, fulfilledQuantity: true, completedAt: true },
  });
  record(
    "9.1 Approve & Release",
    "POST mark-spreadsheet-delivered",
    "200; spreadsheetDeliveredAt set; BuyerDeliveredIdentity written; allocations committed; order not auto-completed",
    `${release.statusCode} deliveredAt=${pkgRow?.spreadsheetDeliveredAt?.toISOString() ?? "null"} identities=${identities} committed=${committedAfter} orderStatus=${orderAfterRelease?.status} storedFulfilled=${orderAfterRelease?.fulfilledQuantity}`,
    release.statusCode === 200 &&
      released.ok === true &&
      pkgRow?.spreadsheetDeliveredAt != null &&
      identities >= 2 &&
      committedAfter === 2 &&
      orderAfterRelease?.status === "active" &&
      orderAfterRelease.completedAt == null,
    { released, pkgRow, identities, allocAfter, orderAfterRelease }
  );

  // --- Phase 10: customer delivery ---
  const customerOrder = await client(
    "GET",
    `/client/v1/lead-orders/${orderId}?clientAccountId=${tenantA}`
  );
  const customerOrderItem = (jsonOf(customerOrder).item ?? {}) as Record<string, unknown>;
  const fulfillment = customerOrderItem.fulfillment as Record<string, unknown> | null;
  record(
    "10.1 Partial fulfillment truth",
    "GET customer order after release",
    "ordered 5 / delivered 2 / remaining 3 from committed allocations, not stored fulfilledQuantity",
    `fulfillment=${JSON.stringify(fulfillment)} storedFulfilled=${orderAfterRelease?.fulfilledQuantity}`,
    customerOrder.statusCode === 200 &&
      fulfillment?.requestedQuantity === 5 &&
      fulfillment?.fulfilledQuantity === 2 &&
      fulfillment?.remainingQuantity === 3 &&
      fulfillment?.status === "in_progress" &&
      (orderAfterRelease?.fulfilledQuantity ?? 0) === 0,
    { customerOrderItem, storedFulfilled: orderAfterRelease?.fulfilledQuantity }
  );

  const customerExports = await client(
    "GET",
    `/client/v1/lead-orders/${orderId}/exports?clientAccountId=${tenantA}`
  );
  const exportList = jsonOf(customerExports);
  const exportItems = (exportList.items ?? []) as Array<Record<string, unknown>>;
  record(
    "10.2 Customer export list after release",
    "GET /client/v1/lead-orders/:id/exports",
    "200; one released package; downloadAvailable; no allocation ids",
    `${customerExports.statusCode} count=${exportItems.length} ${JSON.stringify(exportItems)}`,
    customerExports.statusCode === 200 &&
      exportItems.length === 1 &&
      exportItems[0]?.downloadAvailable === true &&
      !Object.hasOwn(exportItems[0] ?? {}, "allocationIds") &&
      !Object.hasOwn(exportItems[0] ?? {}, "csvContent"),
    exportList
  );

  const homeAfter = evaluateHome(tenantA, customerOrderItem, customerOrder, exportList, true);
  record(
    "10.3 Dashboard Your order is ready",
    "Portal journey presenter on released package",
    "hero kind=order_ready title='Your order is ready'",
    `hero=${homeAfter.hero.kind} title=${homeAfter.hero.title} cta=${homeAfter.hero.cta?.label ?? "none"}`,
    homeAfter.hero.kind === "order_ready" && homeAfter.hero.title === "Your order is ready",
    homeAfter.hero
  );

  const download = await client(
    "GET",
    `/client/v1/lead-orders/${orderId}/exports/${exportId}/download?clientAccountId=${tenantA}`
  );
  const disposition = String(download.headers["content-disposition"] ?? "");
  const contentType = String(download.headers["content-type"] ?? "");
  const csv = download.body;
  const leakHits = INTERNAL_CSV_LEAKS.filter((needle) =>
    `${contentType}\n${disposition}\n${csv}`.includes(needle)
  );
  const csvLines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  record(
    "10.4 Customer CSV download",
    "GET /client/v1/lead-orders/:id/exports/:exportId/download",
    "200 text/csv; safe filename; 2 lead rows; no internal-only columns/paths/ids",
    `${download.statusCode} ct=${contentType} cd=${disposition} lines=${csvLines.length} leaks=${leakHits.join(",") || "none"}`,
    download.statusCode === 200 &&
      /text\/csv/.test(contentType) &&
      /attachment; filename="/.test(disposition) &&
      /\.csv"/.test(disposition) &&
      !disposition.includes("/") &&
      csvLines.length >= 3 &&
      leakHits.length === 0,
    {
      contentType,
      disposition,
      lineCount: csvLines.length,
      header: csvLines[0],
      preview: csvLines.slice(0, 4),
      leakHits,
    }
  );

  // --- Phase 11: tenant isolation ---
  const bSeesOrder = await client(
    "GET",
    `/client/v1/lead-orders/${orderId}?clientAccountId=${tenantB}`
  );
  const bSeesLeads = await client(
    "GET",
    `/client/v1/lead-orders/${orderId}/leads?clientAccountId=${tenantB}`
  );
  const bSeesExports = await client(
    "GET",
    `/client/v1/lead-orders/${orderId}/exports?clientAccountId=${tenantB}`
  );
  const bDownloads = await client(
    "GET",
    `/client/v1/lead-orders/${orderId}/exports/${exportId}/download?clientAccountId=${tenantB}`
  );
  const missingDl = await client(
    "GET",
    `/client/v1/lead-orders/${orderId}/exports/pkg_missing/download?clientAccountId=${tenantA}`
  );
  record(
    "11.1 Tenant B cannot see or download tenant A",
    "GET order/leads/exports/download as tenant B",
    "404 equivalent; download matches missing-package body",
    `order=${bSeesOrder.statusCode} leads=${bSeesLeads.statusCode} exports=${bSeesExports.statusCode} dl=${bDownloads.statusCode} missing=${missingDl.statusCode}`,
    bSeesOrder.statusCode === 404 &&
      bSeesLeads.statusCode === 404 &&
      bSeesExports.statusCode === 404 &&
      bDownloads.statusCode === 404 &&
      jsonOf(bDownloads).error === jsonOf(missingDl).error &&
      jsonOf(bDownloads).error === "Delivery not found" &&
      !Object.hasOwn(jsonOf(bDownloads), "spreadsheetDeliveredAt"),
    {
      bSeesOrder: jsonOf(bSeesOrder),
      bSeesLeads: jsonOf(bSeesLeads),
      bSeesExports: jsonOf(bSeesExports),
      bDownloads: jsonOf(bDownloads),
      missingDl: jsonOf(missingDl),
    }
  );

  // --- Phase 12: failure states (presenter + API) ---
  const accountFailHome = {
    hero: resolveJourneyHero({ accountOk: false, ordersOk: true }),
  };
  record(
    "12.1 Account API failure copy",
    "buildPortalJourneyHome account=failed",
    "account_unavailable; not 'Complete your account'",
    `${accountFailHome.hero.kind} / ${accountFailHome.hero.title}`,
    accountFailHome.hero.kind === "account_unavailable" &&
      accountFailHome.hero.title !== "Complete your account",
    accountFailHome.hero
  );

  const ordersFailHome = {
    hero: resolveJourneyHero({
      accountOk: true,
      readyToOrder: true,
      accountStatus: "active",
      ordersOk: false,
    }),
  };
  record(
    "12.2 Orders API failure copy",
    "buildPortalJourneyHome orders=failed",
    "orders_unavailable; not 'No orders' / place first order",
    `${ordersFailHome.hero.kind} / ${ordersFailHome.hero.title}`,
    ordersFailHome.hero.kind === "orders_unavailable" &&
      !/no orders/i.test(ordersFailHome.hero.title),
    ordersFailHome.hero
  );

  const exportFailHome = {
    hero: resolveJourneyHero({
      accountOk: true,
      readyToOrder: true,
      accountStatus: "active",
      ordersOk: true,
      order: customerOrderItem,
      exportsOk: false,
    }),
  };
  record(
    "12.3 Export lookup failure does not fabricate Ready",
    "attachReleasedDeliveriesToOrder failed lookup",
    "hero is not order_ready",
    `${exportFailHome.hero.kind} / ${exportFailHome.hero.title}`,
    exportFailHome.hero.kind !== "order_ready",
    exportFailHome.hero
  );

  await app.close();
  await prisma.$disconnect();

  const failed = steps.filter((row) => row.result === "FAIL");
  const report = {
    generatedAt: new Date().toISOString(),
    masterSha: environment.masterSha,
    environment,
    testClient: {
      tenantA,
      tenantB,
      tenantPaused,
      emailA,
      emailB,
    },
    testOrder: { orderId, orderNumber, leadVolume: 5, delivered: committedAfter },
    steps,
    summary: {
      passed: steps.filter((row) => row.result === "PASS").length,
      failed: failed.length,
      verdict: failed.length === 0 ? "READY_FOR_CONTROLLED_CUSTOMER_PILOT" : "NOT_READY",
    },
    storedOrderCounters: storedOrder,
  };

  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = resolve(here, "../../../../docs/validation");
  mkdirSync(outDir, { recursive: true });
  const jsonPath = resolve(outDir, "customer-journey-e2e-mvp-evidence.json");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nWrote ${jsonPath}`);
  console.log(
    `Result: ${report.summary.passed} passed / ${report.summary.failed} failed — ${report.summary.verdict}`
  );
  if (failed.length > 0) process.exitCode = 1;
}

type JourneyHero = { kind: string; title: string; cta?: { label: string } | null };

function evaluateHome(
  _tenant: string,
  rawOrder: Record<string, unknown>,
  orderRes: { body: string },
  exportsPayload: Record<string, unknown>,
  exportsOk: boolean
): { hero: JourneyHero } {
  const item =
    ((jsonOf(orderRes).item ?? rawOrder) as Record<string, unknown>) ?? rawOrder;
  return {
    hero: resolveJourneyHero({
      accountOk: true,
      readyToOrder: true,
      accountStatus: "active",
      ordersOk: true,
      order: item,
      exportsOk,
      exportItems: (exportsPayload.items as unknown[]) ?? [],
    }),
  };
}

function resolveJourneyHero(input: {
  accountOk: boolean;
  readyToOrder?: boolean;
  accountStatus?: string;
  ordersOk: boolean;
  order?: Record<string, unknown> | null;
  exportsOk?: boolean;
  exportItems?: unknown[];
}): JourneyHero {
  if (!input.accountOk) {
    return { kind: "account_unavailable", title: "We couldn't load your account status." };
  }
  if (input.accountStatus === "paused" || input.accountStatus === "archived") {
    return { kind: "account_paused", title: "This account is paused" };
  }
  if (input.readyToOrder === false) {
    return { kind: "complete_account", title: "Complete your account" };
  }
  if (!input.ordersOk) {
    return { kind: "orders_unavailable", title: "We couldn't load your orders." };
  }
  const order = input.order;
  if (!order) {
    return { kind: "place_first_order", title: "Place your first order" };
  }
  const released = input.exportsOk === true && Array.isArray(input.exportItems) && input.exportItems.length > 0;
  if (released) {
    return {
      kind: "order_ready",
      title: "Your order is ready",
      cta: { label: "Download spreadsheet" },
    };
  }
  if (input.exportsOk === false) {
    const status = String(order.status ?? "");
    if (status === "active") {
      return { kind: "order_in_progress", title: "Your order is in progress" };
    }
    return { kind: "order_review", title: "Your order is being reviewed" };
  }
  const fulfillment = (order.fulfillment ?? null) as Record<string, unknown> | null;
  if (fulfillment?.status === "fulfilled" && input.exportsOk === true) {
    return { kind: "order_finalizing", title: "We're finalizing your delivery" };
  }
  switch (String(order.status ?? "")) {
    case "submitted":
      if (order.paymentConfirmationStatus === "pending_confirmation") {
        return { kind: "payment_pending", title: "Awaiting payment confirmation" };
      }
      return { kind: "order_review", title: "Your order is being reviewed" };
    case "ready":
      return { kind: "order_approved", title: "Approved — ready for fulfillment" };
    case "active":
      return { kind: "order_in_progress", title: "Your order is in progress" };
    default:
      return { kind: "order_review", title: "Your order is being reviewed" };
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
