/**
 * Connected portal-auth regression against local sa360_test.
 * Walks C.O.C. invite issuance → customer accept → login isolation → reset.
 * Product code is not modified. No real email.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";
import Fastify from "fastify";

import { ADMIN_KEY_HEADER } from "../../lib/admin-auth.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../../lib/client-portal-auth.js";
import { evaluatePortalPasswordConfirmation } from "@sa360/shared";
import { hashPortalPassword } from "../../lib/portal-password.js";
import {
  hashPortalInviteToken,
  isWellFormedPortalInviteToken,
  PORTAL_INVITE_TTL_MS,
  PORTAL_PASSWORD_RESET_TTL_MS,
} from "../../lib/portal-invite-token.js";
import type { SendTransactionalEmailInput } from "../../lib/transactional-email.js";
import type { RateLimitConsume } from "../../lib/redis-rate-limit.js";
import { PORTAL_PASSWORD_RESET_GENERIC } from "../portal-password-reset.service.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  countCommittedAllocationsByOrderIds,
  findLeadOrderById,
  listLeadOrders,
} from "../../repositories/lead-order.repository.js";
import { adminClientsRoutes } from "../../routes/admin-clients.js";
import { clientPortalRoutes } from "../../routes/client-portal.js";
import { presentClientAccountDetail } from "../client-onboarding.present.js";
import { PORTAL_INVITE_INVALID } from "../portal-invite.service.js";
import {
  ADMIN_TEST_KEY,
  cleanupPortalAuthRegression,
  PORTAL_TEST_KEY,
  seedPortalAuthRegressionFixture,
  SESSION_TEST_SECRET,
  SHARED_ENV_PASSWORD,
  TENANT_A_CLIENT_ID,
  TENANT_A_EMAIL,
  TENANT_A_PW1,
  TENANT_A_PW2,
  TENANT_A_PW3,
  TENANT_B_CLIENT_ID,
  TENANT_B_EMAIL,
  TENANT_DISABLED_CLIENT_ID,
  TENANT_DISABLED_EMAIL,
} from "./portal-auth-integrated-regression.fixtures.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

const ADMIN_PREFIX = "/admin/v1";
const PORTAL_PREFIX = "/client/v1";
const RAW_TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

/**
 * Same strict-equality contract as
 * `apps/admin-coc/src/lib/client-portal/portal-session.ts` `isPortalSessionEpochCurrent`.
 * `readTrustedPortalSession` in `portal-auth.ts` rejects the cookie when this is false.
 * Direct import of that Next.js module from the API test runner fails (ESM cycle).
 */
function isPortalSessionEpochCurrent(sessionEpoch: number, currentEpoch: number): boolean {
  return sessionEpoch === currentEpoch;
}

/**
 * Same contract as `portalBffHasBrowserTenantOverride` in
 * `apps/admin-coc/src/lib/client-portal/portal-bff-auth.ts`.
 * `true` means a browser-supplied `clientAccountId` is present and must be rejected by the BFF.
 */
function portalBffHasBrowserTenantOverride(searchParams: URLSearchParams): boolean {
  return searchParams.has("clientAccountId");
}

/**
 * Same contract as `portalPasswordStatusLabel` in
 * `apps/admin-coc/src/lib/clients/portal-invite-operator.ts`.
 */
function portalPasswordStatusLabel(hasPortalPassword: boolean | undefined): string {
  return hasPortalPassword ? "Set" : "Not set";
}

describe("portal-auth integrated invite-to-login regression", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  let tenantAOrderId = "";
  let tenantBOrderId = "";
  const previousEnv: Record<string, string | undefined> = {};

  before(async () => {
    if (!integrationUrlRaw) {
      throw new Error(
        "SA360_TEST_DATABASE_URL is required for this Cloud validation run (local sa360_test only)"
      );
    }
    const integrationUrl = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = integrationUrl;

    for (const key of [
      "CLIENT_PORTAL_LOGIN_PASSWORD",
      "ADMIN_API_KEY",
      "CLIENT_PORTAL_API_KEY",
      "CLIENT_PORTAL_SESSION_SECRET",
      "CLIENT_PORTAL_CLIENT_ACCOUNT_ID",
      "ADMIN_COC_BASE_URL",
      "SA360_PORTAL_PUBLIC_BASE_URL",
      "RESEND_API_KEY",
    ]) {
      previousEnv[key] = process.env[key];
    }
    process.env.CLIENT_PORTAL_LOGIN_PASSWORD = SHARED_ENV_PASSWORD;
    process.env.ADMIN_API_KEY = ADMIN_TEST_KEY;
    process.env.CLIENT_PORTAL_API_KEY = PORTAL_TEST_KEY;
    process.env.CLIENT_PORTAL_SESSION_SECRET = SESSION_TEST_SECRET;
    process.env.ADMIN_COC_BASE_URL = "https://portal.example.test";
    delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
    delete process.env.SA360_PORTAL_PUBLIC_BASE_URL;
    delete process.env.RESEND_API_KEY;

    db = new PrismaClient({ datasources: { db: { url: integrationUrl } } });
    const seeded = await seedPortalAuthRegressionFixture(db);
    tenantAOrderId = seeded.tenantAOrderId;
    tenantBOrderId = seeded.tenantBOrderId;
  });

  after(async () => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (db) {
      await cleanupPortalAuthRegression(db);
      await db.$disconnect();
    }
  });

  function orderDeps() {
    return {
      db,
      findLeadOrderByIdImpl: (id: string) => findLeadOrderById(id, db),
      listLeadOrdersImpl: (filters: Parameters<typeof listLeadOrders>[0]) =>
        listLeadOrders(filters, db),
      countCommittedAllocationsByOrderIdsImpl: (ids: string[]) =>
        countCommittedAllocationsByOrderIds(ids, db),
    };
  }

  async function buildApp() {
    const app = Fastify({ logger: false });
    await app.register(adminClientsRoutes, {
      prefix: ADMIN_PREFIX,
      inviteDeps: { db },
    });
    await app.register(clientPortalRoutes, {
      prefix: PORTAL_PREFIX,
      tenantDeps: { db },
      leadOrderDeps: orderDeps(),
    });
    return app;
  }

  function portalHeaders(): Record<string, string> {
    return {
      [CLIENT_PORTAL_KEY_HEADER]: PORTAL_TEST_KEY,
      "content-type": "application/json",
    };
  }

  function adminHeaders(): Record<string, string> {
    return { [ADMIN_KEY_HEADER]: ADMIN_TEST_KEY };
  }

  function extractInviteToken(inviteUrl: string): string {
    const marker = "/portal/invite/";
    const idx = inviteUrl.lastIndexOf(marker);
    assert.ok(idx >= 0, `inviteUrl missing ${marker}: ${inviteUrl}`);
    return inviteUrl.slice(idx + marker.length);
  }

  function assertNoSecrets(
    label: string,
    raw: string,
    extraForbidden: string[] = []
  ): void {
    const forbidden = [
      SHARED_ENV_PASSWORD,
      TENANT_A_PW1,
      TENANT_A_PW2,
      TENANT_A_PW3,
      ADMIN_TEST_KEY,
      PORTAL_TEST_KEY,
      SESSION_TEST_SECRET,
      "portalPasswordHash",
      "portalInviteTokenHash",
      "scrypt$",
      ...extraForbidden,
    ];
    for (const secret of forbidden) {
      assert.equal(
        raw.includes(secret),
        false,
        `${label} leaked ${secret === SHARED_ENV_PASSWORD ? "CLIENT_PORTAL_LOGIN_PASSWORD" : secret}`
      );
    }
  }

  async function loadTenantA() {
    const row = await db.clientAccount.findUnique({
      where: { clientAccountId: TENANT_A_CLIENT_ID },
      include: { ghlDestination: true },
    });
    assert.ok(row, "Tenant A missing");
    return row;
  }

  async function loadTenantB() {
    const row = await db.clientAccount.findUnique({
      where: { clientAccountId: TENANT_B_CLIENT_ID },
    });
    assert.ok(row, "Tenant B missing");
    return row;
  }

  it(
    "converts Tenant A through invite accept, revokes old sessions, isolates tenants, and resets",
    { timeout: 120_000 },
    async () => {
      const app = await buildApp();
      const collectedBodies: { label: string; body: string; mayContainRawInviteToken?: boolean }[] =
        [];

      try {
        // 1. Tenant A initially authenticates via env fallback
        const loginEnv = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-login`,
          headers: portalHeaders(),
          payload: { loginEmail: TENANT_A_EMAIL, password: SHARED_ENV_PASSWORD },
        });
        collectedBodies.push({ label: "login env fallback A", body: loginEnv.body });
        assert.equal(loginEnv.statusCode, 200, loginEnv.body);
        const loginEnvBody = loginEnv.json() as {
          ok: boolean;
          passwordCheck: string;
          portalSessionEpoch: number;
        };
        assert.equal(loginEnvBody.ok, true);
        assert.equal(loginEnvBody.passwordCheck, "env_fallback");
        assert.equal(loginEnvBody.portalSessionEpoch, 0);
        assertNoSecrets("login env fallback A", loginEnv.body);

        // 2. Pre-conversion session at epoch 0 is current
        const preConversionSession = {
          clientAccountId: TENANT_A_CLIENT_ID,
          portalSessionEpoch: 0,
        };
        const session0 = await app.inject({
          method: "GET",
          url: `${PORTAL_PREFIX}/portal-session-state?clientAccountId=${TENANT_A_CLIENT_ID}`,
          headers: portalHeaders(),
        });
        collectedBodies.push({ label: "session-state epoch 0", body: session0.body });
        assert.equal(session0.statusCode, 200, session0.body);
        const session0Body = session0.json() as {
          portalSessionEpoch: number;
          portalEnabled: boolean;
        };
        assert.equal(session0Body.portalSessionEpoch, 0);
        assert.equal(session0Body.portalEnabled, true);
        // readTrustedPortalSession uses isPortalSessionEpochCurrent(sessionEpoch, dbEpoch)
        assert.equal(isPortalSessionEpochCurrent(preConversionSession.portalSessionEpoch, 0), true);
        assertNoSecrets("session-state epoch 0", session0.body);

        // 3. Actual admin invite issuance path
        const issuedAt = Date.now();
        const issue1 = await app.inject({
          method: "POST",
          url: `${ADMIN_PREFIX}/clients/${TENANT_A_CLIENT_ID}/portal-invite`,
          headers: adminHeaders(),
        });
        collectedBodies.push({
          label: "admin issue invite 1",
          body: issue1.body,
          mayContainRawInviteToken: true,
        });
        assert.equal(issue1.statusCode, 200, issue1.body);
        const issue1Body = issue1.json() as {
          ok: boolean;
          inviteUrl: string;
          expiresAt: string;
        };
        assert.equal(issue1Body.ok, true);
        assert.ok(issue1Body.inviteUrl.includes("/portal/invite/"));
        const rawToken1 = extractInviteToken(issue1Body.inviteUrl);
        assert.match(rawToken1, RAW_TOKEN_RE);
        assert.equal(isWellFormedPortalInviteToken(rawToken1), true);
        const expectedExpiry1 = issuedAt + PORTAL_INVITE_TTL_MS;
        const actualExpiry1 = Date.parse(issue1Body.expiresAt);
        assert.ok(
          Math.abs(actualExpiry1 - expectedExpiry1) < 5000,
          `invite expiry ${issue1Body.expiresAt} not ~48h from now`
        );
        assert.equal("portalPasswordHash" in issue1Body, false);
        assert.equal("portalInviteTokenHash" in issue1Body, false);
        assertNoSecrets("admin issue invite 1", issue1.body);

        const afterIssue1 = await loadTenantA();
        assert.match(afterIssue1.portalInviteTokenHash ?? "", HEX64_RE);
        assert.equal(afterIssue1.portalInviteTokenHash, hashPortalInviteToken(rawToken1));
        assert.notEqual(afterIssue1.portalInviteTokenHash, rawToken1);
        assert.ok(afterIssue1.portalInviteExpiresAt);
        assert.ok(
          Math.abs(afterIssue1.portalInviteExpiresAt.getTime() - expectedExpiry1) < 5000
        );

        const adminAfterIssue = await app.inject({
          method: "GET",
          url: `${ADMIN_PREFIX}/clients/${TENANT_A_CLIENT_ID}`,
          headers: adminHeaders(),
        });
        collectedBodies.push({ label: "admin detail after issue 1", body: adminAfterIssue.body });
        assert.equal(adminAfterIssue.statusCode, 200, adminAfterIssue.body);
        const adminAfterIssueItem = (
          adminAfterIssue.json() as {
            item: { hasPortalPassword: boolean; hasOutstandingPortalInvite: boolean };
          }
        ).item;
        assert.equal(adminAfterIssueItem.hasPortalPassword, false);
        assert.equal(adminAfterIssueItem.hasOutstandingPortalInvite, true);
        assert.equal("portalPasswordHash" in adminAfterIssueItem, false);
        assert.equal("portalInviteTokenHash" in adminAfterIssueItem, false);
        assert.equal(adminAfterIssue.body.includes(rawToken1), false);
        assertNoSecrets("admin detail after issue 1", adminAfterIssue.body, [rawToken1]);

        const presentedAfterIssue = presentClientAccountDetail(afterIssue1, [], null);
        assert.equal(presentedAfterIssue.hasPortalPassword, false);
        assert.equal(presentedAfterIssue.hasOutstandingPortalInvite, true);
        assert.equal("portalPasswordHash" in presentedAfterIssue, false);
        assert.equal("portalInviteTokenHash" in presentedAfterIssue, false);

        // 4. Customer invite accept path
        const inspect1 = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-invite/inspect`,
          headers: portalHeaders(),
          payload: { token: rawToken1 },
        });
        collectedBodies.push({ label: "inspect invite 1", body: inspect1.body });
        assert.equal(inspect1.statusCode, 200, inspect1.body);
        assert.equal((inspect1.json() as { ok: boolean }).ok, true);
        assert.equal(inspect1.body.includes(rawToken1), false);
        assert.equal(inspect1.body.includes(TENANT_A_CLIENT_ID), false);

        const accept1 = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-invite/accept`,
          headers: portalHeaders(),
          payload: { token: rawToken1, password: TENANT_A_PW1 },
        });
        collectedBodies.push({ label: "accept invite 1", body: accept1.body });
        assert.equal(accept1.statusCode, 200, accept1.body);
        const accept1Body = accept1.json() as { ok: boolean };
        assert.equal(accept1Body.ok, true);
        assert.equal(Object.keys(accept1Body).join(","), "ok");
        assert.equal(accept1.body.includes(rawToken1), false);
        assert.equal(accept1.body.includes(TENANT_A_CLIENT_ID), false);
        assertNoSecrets("accept invite 1", accept1.body, [rawToken1]);

        const afterAccept1 = await loadTenantA();
        assert.ok(afterAccept1.portalPasswordHash);
        assert.match(afterAccept1.portalPasswordHash, /^scrypt\$/);
        assert.notEqual(afterAccept1.portalPasswordHash, TENANT_A_PW1);
        assert.ok(afterAccept1.portalPasswordSetAt);
        assert.equal(afterAccept1.portalInviteTokenHash, null);
        assert.equal(afterAccept1.portalInviteExpiresAt, null);
        assert.equal(afterAccept1.portalSessionEpoch, 1);

        // 5. Replay same invite
        const replay1 = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-invite/accept`,
          headers: portalHeaders(),
          payload: { token: rawToken1, password: TENANT_A_PW1 },
        });
        collectedBodies.push({ label: "replay invite 1", body: replay1.body });
        assert.equal(replay1.statusCode, 400, replay1.body);
        const replay1Body = replay1.json() as { error: string; code: string };
        assert.equal(replay1Body.error, PORTAL_INVITE_INVALID);
        assert.equal(replay1Body.code, "INVITE_INVALID");
        assert.equal(replay1.body.includes(TENANT_A_CLIENT_ID), false);
        assert.equal(replay1.body.includes(TENANT_A_EMAIL), false);
        assertNoSecrets("replay invite 1", replay1.body, [rawToken1]);

        // 6. Old epoch-0 session is no longer current
        const session1 = await app.inject({
          method: "GET",
          url: `${PORTAL_PREFIX}/portal-session-state?clientAccountId=${TENANT_A_CLIENT_ID}`,
          headers: portalHeaders(),
        });
        collectedBodies.push({ label: "session-state epoch 1", body: session1.body });
        assert.equal(session1.statusCode, 200, session1.body);
        const session1Body = session1.json() as { portalSessionEpoch: number };
        assert.equal(session1Body.portalSessionEpoch, 1);
        assert.equal(isPortalSessionEpochCurrent(0, 1), false);
        assert.equal(isPortalSessionEpochCurrent(preConversionSession.portalSessionEpoch, 1), false);
        assertNoSecrets("session-state epoch 1", session1.body);

        // 7. New customer password authenticates
        const loginPw1 = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-login`,
          headers: portalHeaders(),
          payload: { loginEmail: TENANT_A_EMAIL, password: TENANT_A_PW1 },
        });
        collectedBodies.push({ label: "login A pw1", body: loginPw1.body });
        assert.equal(loginPw1.statusCode, 200, loginPw1.body);
        const loginPw1Body = loginPw1.json() as {
          ok: boolean;
          passwordCheck: string;
          portalSessionEpoch: number;
        };
        assert.equal(loginPw1Body.ok, true);
        assert.equal(loginPw1Body.passwordCheck, "customer");
        assert.equal(loginPw1Body.portalSessionEpoch, 1);
        assertNoSecrets("login A pw1", loginPw1.body);

        // 8. Shared env password fails for converted Tenant A
        const loginEnvAfter = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-login`,
          headers: portalHeaders(),
          payload: { loginEmail: TENANT_A_EMAIL, password: SHARED_ENV_PASSWORD },
        });
        collectedBodies.push({ label: "login A env after convert", body: loginEnvAfter.body });
        assert.equal(loginEnvAfter.statusCode, 401, loginEnvAfter.body);
        assert.equal((loginEnvAfter.json() as { code: string }).code, "INVALID");
        assertNoSecrets("login A env after convert", loginEnvAfter.body);

        // 9. Tenant B still env_fallback
        const loginBEnv = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-login`,
          headers: portalHeaders(),
          payload: { loginEmail: TENANT_B_EMAIL, password: SHARED_ENV_PASSWORD },
        });
        collectedBodies.push({ label: "login B env fallback", body: loginBEnv.body });
        assert.equal(loginBEnv.statusCode, 200, loginBEnv.body);
        const loginBEnvBody = loginBEnv.json() as {
          passwordCheck: string;
          portalSessionEpoch: number;
        };
        assert.equal(loginBEnvBody.passwordCheck, "env_fallback");
        assert.equal(loginBEnvBody.portalSessionEpoch, 0);
        const tenantBAfterAConvert = await loadTenantB();
        assert.equal(tenantBAfterAConvert.portalPasswordHash, null);
        assert.equal(tenantBAfterAConvert.portalSessionEpoch, 0);
        assertNoSecrets("login B env fallback", loginBEnv.body);

        // 10. Cross-tenant isolation
        const crossLogin = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-login`,
          headers: portalHeaders(),
          payload: { loginEmail: TENANT_B_EMAIL, password: TENANT_A_PW1 },
        });
        collectedBodies.push({ label: "cross-tenant login B+A pw", body: crossLogin.body });
        assert.equal(crossLogin.statusCode, 401, crossLogin.body);
        assert.equal((crossLogin.json() as { code: string }).code, "INVALID");

        const listAsA = await app.inject({
          method: "GET",
          url: `${PORTAL_PREFIX}/lead-orders?clientAccountId=${TENANT_A_CLIENT_ID}`,
          headers: portalHeaders(),
        });
        collectedBodies.push({ label: "lead-orders list as A", body: listAsA.body });
        assert.equal(listAsA.statusCode, 200, listAsA.body);
        const listAsABody = listAsA.json() as { items: { id: string; clientAccountId?: string }[] };
        const listedIds = listAsABody.items.map((row) => row.id);
        assert.equal(listedIds.includes(tenantAOrderId), true);
        assert.equal(listedIds.includes(tenantBOrderId), false);
        assert.equal(
          listAsABody.items.some((row) => row.clientAccountId === TENANT_B_CLIENT_ID),
          false
        );

        const bOrderAsA = await app.inject({
          method: "GET",
          url: `${PORTAL_PREFIX}/lead-orders/${tenantBOrderId}?clientAccountId=${TENANT_A_CLIENT_ID}`,
          headers: portalHeaders(),
        });
        collectedBodies.push({ label: "B order as A", body: bOrderAsA.body });
        assert.equal(bOrderAsA.statusCode, 404, bOrderAsA.body);

        const bLeadsAsA = await app.inject({
          method: "GET",
          url: `${PORTAL_PREFIX}/lead-orders/${tenantBOrderId}/leads?clientAccountId=${TENANT_A_CLIENT_ID}`,
          headers: portalHeaders(),
        });
        collectedBodies.push({ label: "B leads as A", body: bLeadsAsA.body });
        assert.equal(bLeadsAsA.statusCode, 404, bLeadsAsA.body);

        const bExportsAsA = await app.inject({
          method: "GET",
          url: `${PORTAL_PREFIX}/lead-orders/${tenantBOrderId}/exports?clientAccountId=${TENANT_A_CLIENT_ID}`,
          headers: portalHeaders(),
        });
        collectedBodies.push({ label: "B exports as A", body: bExportsAsA.body });
        assert.equal(bExportsAsA.statusCode, 404, bExportsAsA.body);

        const hijack = new URLSearchParams({
          range: "7d",
          clientAccountId: TENANT_B_CLIENT_ID,
        });
        assert.equal(portalBffHasBrowserTenantOverride(hijack), true);
        assert.equal(
          portalBffHasBrowserTenantOverride(new URLSearchParams({ range: "7d" })),
          false
        );

        // 11. Password reset invite increments epoch again
        const issuedAt2 = Date.now();
        const issue2 = await app.inject({
          method: "POST",
          url: `${ADMIN_PREFIX}/clients/${TENANT_A_CLIENT_ID}/portal-invite`,
          headers: adminHeaders(),
        });
        collectedBodies.push({
          label: "admin issue invite 2",
          body: issue2.body,
          mayContainRawInviteToken: true,
        });
        assert.equal(issue2.statusCode, 200, issue2.body);
        const issue2Body = issue2.json() as { inviteUrl: string; expiresAt: string };
        const rawToken2 = extractInviteToken(issue2Body.inviteUrl);
        assert.match(rawToken2, RAW_TOKEN_RE);
        assert.notEqual(rawToken2, rawToken1);
        assert.ok(Math.abs(Date.parse(issue2Body.expiresAt) - (issuedAt2 + PORTAL_INVITE_TTL_MS)) < 5000);
        assertNoSecrets("admin issue invite 2", issue2.body);

        const afterIssue2 = await loadTenantA();
        assert.equal(afterIssue2.portalInviteTokenHash, hashPortalInviteToken(rawToken2));
        assert.equal(afterIssue2.portalSessionEpoch, 1);

        const accept2 = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-invite/accept`,
          headers: portalHeaders(),
          payload: { token: rawToken2, password: TENANT_A_PW2 },
        });
        collectedBodies.push({ label: "accept invite 2", body: accept2.body });
        assert.equal(accept2.statusCode, 200, accept2.body);
        assert.equal((accept2.json() as { ok: boolean }).ok, true);
        assertNoSecrets("accept invite 2", accept2.body, [rawToken2]);

        const afterAccept2 = await loadTenantA();
        assert.equal(afterAccept2.portalSessionEpoch, 2);
        assert.ok(afterAccept2.portalPasswordHash?.startsWith("scrypt$"));
        assert.notEqual(afterAccept2.portalPasswordHash, TENANT_A_PW2);
        assert.equal(afterAccept2.portalInviteTokenHash, null);
        assert.equal(isPortalSessionEpochCurrent(1, 2), false);

        const loginPw1AfterReset = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-login`,
          headers: portalHeaders(),
          payload: { loginEmail: TENANT_A_EMAIL, password: TENANT_A_PW1 },
        });
        collectedBodies.push({ label: "login A pw1 after reset", body: loginPw1AfterReset.body });
        assert.equal(loginPw1AfterReset.statusCode, 401, loginPw1AfterReset.body);
        assert.equal((loginPw1AfterReset.json() as { code: string }).code, "INVALID");

        const loginPw2 = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-login`,
          headers: portalHeaders(),
          payload: { loginEmail: TENANT_A_EMAIL, password: TENANT_A_PW2 },
        });
        collectedBodies.push({ label: "login A pw2", body: loginPw2.body });
        assert.equal(loginPw2.statusCode, 200, loginPw2.body);
        const loginPw2Body = loginPw2.json() as {
          passwordCheck: string;
          portalSessionEpoch: number;
        };
        assert.equal(loginPw2Body.passwordCheck, "customer");
        assert.equal(loginPw2Body.portalSessionEpoch, 2);

        const loginEnvFinalA = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-login`,
          headers: portalHeaders(),
          payload: { loginEmail: TENANT_A_EMAIL, password: SHARED_ENV_PASSWORD },
        });
        collectedBodies.push({ label: "login A env final", body: loginEnvFinalA.body });
        assert.equal(loginEnvFinalA.statusCode, 401, loginEnvFinalA.body);

        const loginBFinal = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-login`,
          headers: portalHeaders(),
          payload: { loginEmail: TENANT_B_EMAIL, password: SHARED_ENV_PASSWORD },
        });
        collectedBodies.push({ label: "login B env final", body: loginBFinal.body });
        assert.equal(loginBFinal.statusCode, 200, loginBFinal.body);
        assert.equal((loginBFinal.json() as { passwordCheck: string }).passwordCheck, "env_fallback");
        const tenantBFinal = await loadTenantB();
        assert.equal(tenantBFinal.portalPasswordHash, null);
        assert.equal(tenantBFinal.portalSessionEpoch, 0);

        // 12. C.O.C. operator DTO + label after conversion
        const adminFinal = await app.inject({
          method: "GET",
          url: `${ADMIN_PREFIX}/clients/${TENANT_A_CLIENT_ID}`,
          headers: adminHeaders(),
        });
        collectedBodies.push({ label: "admin detail final", body: adminFinal.body });
        assert.equal(adminFinal.statusCode, 200, adminFinal.body);
        const adminFinalItem = (
          adminFinal.json() as {
            item: { hasPortalPassword: boolean; hasOutstandingPortalInvite: boolean };
          }
        ).item;
        assert.equal(adminFinalItem.hasPortalPassword, true);
        assert.equal(adminFinalItem.hasOutstandingPortalInvite, false);
        assert.equal(portalPasswordStatusLabel(true), "Set");
        assert.equal(adminFinal.body.includes("Show Password"), false);
        assert.equal(adminFinal.body.includes("CLIENT_PORTAL_LOGIN_PASSWORD"), false);
        const presentedFinal = presentClientAccountDetail(afterAccept2, [], null);
        assert.equal(presentedFinal.hasPortalPassword, true);
        assert.equal(presentedFinal.hasOutstandingPortalInvite, false);

        // 13. Live HTTP bodies never include secrets.
        // Raw invite tokens are allowed only in the admin issue inviteUrl path.
        for (const row of collectedBodies) {
          const extra = row.mayContainRawInviteToken ? [] : [rawToken1, rawToken2];
          assertNoSecrets(row.label, row.body, extra);
        }
      } finally {
        await app.close();
      }
    }
  );

  it(
    "self-service forgot-password issues a 60-minute reset, requires confirmation, and revokes sessions",
    { timeout: 120_000 },
    async () => {
      const sent: SendTransactionalEmailInput[] = [];
      const counts = new Map<string, number>();
      const consumeRateLimit: RateLimitConsume = async (bucket, limit) => {
        const n = (counts.get(bucket) ?? 0) + 1;
        counts.set(bucket, n);
        return { allowed: n <= limit };
      };
      const app = Fastify({ logger: false });
      await app.register(adminClientsRoutes, {
        prefix: ADMIN_PREFIX,
        inviteDeps: { db },
      });
      await app.register(clientPortalRoutes, {
        prefix: PORTAL_PREFIX,
        tenantDeps: { db },
        leadOrderDeps: orderDeps(),
        passwordResetDeps: {
          db,
          sendEmail: async (input) => {
            sent.push(input);
            return { ok: true, id: "reset-email-test" };
          },
          consumeRateLimit,
        },
      });

      try {
        await db.clientAccount.update({
          where: { clientAccountId: TENANT_A_CLIENT_ID },
          data: {
            portalPasswordHash: await hashPortalPassword(TENANT_A_PW2),
            portalPasswordSetAt: new Date(),
            portalSessionEpoch: 2,
            portalInviteTokenHash: null,
            portalInviteExpiresAt: null,
          },
        });
        await db.clientAccount.upsert({
          where: { clientAccountId: TENANT_DISABLED_CLIENT_ID },
          create: {
            clientAccountId: TENANT_DISABLED_CLIENT_ID,
            clientDisplayName: "Portal Auth Regression Disabled",
            status: "active",
            portalEnabled: false,
            portalDisplayName: "Disabled Portal",
            portalLoginEmail: TENANT_DISABLED_EMAIL,
            portalPasswordHash: await hashPortalPassword("disabled-customer-pw"),
            portalPasswordSetAt: new Date(),
            portalSessionEpoch: 1,
            primaryNicheKeys: ["vet"],
            primaryProductTypes: ["aged_leads"],
            notes: "Localhost-only disabled portal-auth regression tenant",
          },
          update: {
            portalEnabled: false,
            portalLoginEmail: TENANT_DISABLED_EMAIL,
            portalPasswordHash: await hashPortalPassword("disabled-customer-pw"),
            portalInviteTokenHash: null,
          },
        });

        const genericBodies: string[] = [];
        for (const email of [
          "unknown.authreg.20260902@example.test",
          TENANT_B_EMAIL,
          TENANT_DISABLED_EMAIL,
        ]) {
          const res = await app.inject({
            method: "POST",
            url: `${PORTAL_PREFIX}/portal-password-reset/request`,
            headers: portalHeaders(),
            payload: { email },
          });
          assert.equal(res.statusCode, 200, res.body);
          assert.deepEqual(res.json(), { ok: true, message: PORTAL_PASSWORD_RESET_GENERIC });
          genericBodies.push(res.body);
          assert.equal(res.body.includes(TENANT_A_CLIENT_ID), false);
          assert.equal(res.body.includes(email), false);
        }
        assert.equal(genericBodies[0], genericBodies[1]);
        assert.equal(genericBodies[1], genericBodies[2]);
        assert.equal(sent.length, 0);
        const tenantB = await loadTenantB();
        assert.equal(tenantB.portalInviteTokenHash, null);
        assert.equal(tenantB.portalPasswordHash, null);
        const disabled = await db.clientAccount.findUnique({
          where: { clientAccountId: TENANT_DISABLED_CLIENT_ID },
        });
        assert.equal(disabled?.portalInviteTokenHash, null);

        const issuedAt = Date.now();
        const eligible = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-password-reset/request`,
          headers: portalHeaders(),
          payload: { email: TENANT_A_EMAIL },
        });
        assert.equal(eligible.statusCode, 200, eligible.body);
        assert.deepEqual(eligible.json(), { ok: true, message: PORTAL_PASSWORD_RESET_GENERIC });
        assert.equal(sent.length, 1);
        const resetText = String(sent[0]?.text ?? "");
        const urlMatch = resetText.match(/https:\/\/portal\.example\.test\/portal\/invite\/([A-Za-z0-9_-]+)/);
        assert.ok(urlMatch, resetText);
        const rawToken1 = urlMatch[1]!;
        assert.equal(isWellFormedPortalInviteToken(rawToken1), true);
        assert.equal(resetText.toLowerCase().includes("if you did not request this"), true);
        assert.equal(resetText.includes(TENANT_A_PW2), false);
        assert.equal(resetText.includes(TENANT_A_CLIENT_ID), false);
        assert.equal(eligible.body.includes(rawToken1), false);
        const emailWithoutToken = JSON.stringify({
          ...sent[0],
          text: String(sent[0]?.text ?? "").replaceAll(rawToken1, "[token]"),
          html: String(sent[0]?.html ?? "").replaceAll(rawToken1, "[token]"),
        });
        assertNoSecrets("self-service reset email", emailWithoutToken);

        const afterIssue1 = await loadTenantA();
        assert.equal(afterIssue1.portalInviteTokenHash, hashPortalInviteToken(rawToken1));
        assert.ok(afterIssue1.portalInviteExpiresAt);
        assert.ok(
          Math.abs(afterIssue1.portalInviteExpiresAt.getTime() - (issuedAt + PORTAL_PASSWORD_RESET_TTL_MS)) <
            5000
        );

        const reissue = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-password-reset/request`,
          headers: portalHeaders(),
          payload: { email: TENANT_A_EMAIL },
        });
        assert.equal(reissue.statusCode, 200);
        assert.deepEqual(reissue.json(), eligible.json());
        assert.equal(sent.length, 2);
        const rawToken2 = String(sent[1]?.text.match(/\/portal\/invite\/([A-Za-z0-9_-]+)/)?.[1]);
        assert.notEqual(rawToken2, rawToken1);
        const afterReissue = await loadTenantA();
        assert.equal(afterReissue.portalInviteTokenHash, hashPortalInviteToken(rawToken2));

        const oldAccept = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-invite/accept`,
          headers: portalHeaders(),
          payload: { token: rawToken1, password: TENANT_A_PW3 },
        });
        assert.equal(oldAccept.statusCode, 400);
        assert.equal((oldAccept.json() as { error: string }).error, PORTAL_INVITE_INVALID);

        const mismatch = evaluatePortalPasswordConfirmation(TENANT_A_PW3, "other-password-xx");
        assert.equal(mismatch.ok, false);
        const stillOutstanding = await loadTenantA();
        assert.equal(stillOutstanding.portalInviteTokenHash, hashPortalInviteToken(rawToken2));
        assert.equal(stillOutstanding.portalSessionEpoch, 2);

        const confirmed = evaluatePortalPasswordConfirmation(TENANT_A_PW3, TENANT_A_PW3);
        assert.equal(confirmed.ok, true);
        const accept2 = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-invite/accept`,
          headers: portalHeaders(),
          payload: { token: rawToken2, password: TENANT_A_PW3 },
        });
        assert.equal(accept2.statusCode, 200, accept2.body);
        assert.equal(accept2.body.includes(TENANT_A_PW3), false);
        assert.equal(accept2.body.includes("confirmPassword"), false);

        const afterAccept = await loadTenantA();
        assert.equal(afterAccept.portalInviteTokenHash, null);
        assert.equal(afterAccept.portalSessionEpoch, 3);
        assert.equal(isPortalSessionEpochCurrent(2, 3), false);

        const replay = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-invite/accept`,
          headers: portalHeaders(),
          payload: { token: rawToken2, password: TENANT_A_PW3 },
        });
        assert.equal(replay.statusCode, 400);
        assert.equal((replay.json() as { error: string }).error, PORTAL_INVITE_INVALID);

        const oldPw = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-login`,
          headers: portalHeaders(),
          payload: { loginEmail: TENANT_A_EMAIL, password: TENANT_A_PW2 },
        });
        assert.equal(oldPw.statusCode, 401);
        const newPw = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-login`,
          headers: portalHeaders(),
          payload: { loginEmail: TENANT_A_EMAIL, password: TENANT_A_PW3 },
        });
        assert.equal(newPw.statusCode, 200, newPw.body);
        assert.equal((newPw.json() as { passwordCheck: string }).passwordCheck, "customer");
        assert.equal((newPw.json() as { portalSessionEpoch: number }).portalSessionEpoch, 3);

        const envFallback = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-login`,
          headers: portalHeaders(),
          payload: { loginEmail: TENANT_A_EMAIL, password: SHARED_ENV_PASSWORD },
        });
        assert.equal(envFallback.statusCode, 401);
        const tenantBFinal = await app.inject({
          method: "POST",
          url: `${PORTAL_PREFIX}/portal-login`,
          headers: portalHeaders(),
          payload: { loginEmail: TENANT_B_EMAIL, password: SHARED_ENV_PASSWORD },
        });
        assert.equal(tenantBFinal.statusCode, 200);
        assert.equal((tenantBFinal.json() as { passwordCheck: string }).passwordCheck, "env_fallback");
        const tenantBRow = await loadTenantB();
        assert.equal(tenantBRow.portalPasswordHash, null);
        assert.equal(tenantBRow.portalSessionEpoch, 0);

        const operatorReset = await app.inject({
          method: "POST",
          url: `${ADMIN_PREFIX}/clients/${TENANT_A_CLIENT_ID}/portal-invite`,
          headers: adminHeaders(),
        });
        assert.equal(operatorReset.statusCode, 200, operatorReset.body);
        const operatorUrl = (operatorReset.json() as { inviteUrl: string }).inviteUrl;
        assert.ok(operatorUrl.includes("/portal/invite/"));

        for (let i = 0; i < 20; i += 1) {
          const res = await app.inject({
            method: "POST",
            url: `${PORTAL_PREFIX}/portal-password-reset/request`,
            headers: portalHeaders(),
            payload: { email: TENANT_A_EMAIL },
          });
          assert.equal(res.statusCode, 200);
          assert.deepEqual(res.json(), { ok: true, message: PORTAL_PASSWORD_RESET_GENERIC });
        }
        const emailsForA = sent.filter((row) => row.to === TENANT_A_EMAIL).length;
        assert.ok(emailsForA <= 5, `expected <=5 reset emails for tenant A, got ${emailsForA}`);
      } finally {
        await app.close();
      }
    }
  );
});
