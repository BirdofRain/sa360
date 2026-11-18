import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { signStaffAssertion, STAFF_ASSERTION_HEADER } from "@sa360/shared/staff-assertion";
import Fastify from "fastify";

import { prisma } from "../lib/db.js";
import { assertSafeTestDatabaseUrl } from "../lib/safe-test-database-url.js";
import { adminSmsVerbalConsentRoutes } from "./admin-sms-verbal-consent.js";
import { publicSmsOptInRoutes } from "./public-sms-opt-in.js";

const ADMIN_KEY = "sms-operator-route-test";
const SECRET = "sms-operator-assertion-secret-32";
const PRIVACY = "https://policies.lifeagentlaunch.invalid/privacy";
const TERMS = "https://policies.lifeagentlaunch.invalid/terms";
const ORIGIN = "https://portal.lifeagentlaunch.invalid";

const previousAdminKey = process.env.ADMIN_API_KEY;
const clientIds: string[] = [];
const createdPermissionIds: string[] = [];

function routeEnv(): NodeJS.ProcessEnv {
  return {
    SA360_TEAM_WORKSPACE_ENABLED: "true",
    SA360_STAFF_ASSERTION_SECRET: SECRET,
    SA360_SMS_PRIVACY_POLICY_URL: PRIVACY,
    SA360_SMS_TERMS_URL: TERMS,
    SA360_SMS_OPT_IN_PUBLIC_ORIGIN: ORIGIN,
  };
}

before(() => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL ?? "");
  process.env.ADMIN_API_KEY = ADMIN_KEY;
});

after(async () => {
  if (previousAdminKey == null) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = previousAdminKey;
  if (clientIds.length > 0) {
    await prisma.clientDeliveryNotificationPreference.deleteMany({ where: { clientAccountId: { in: clientIds } } });
    await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } });
  }
  if (createdPermissionIds.length > 0) {
    await prisma.staffPermission.updateMany({
      where: { id: { in: createdPermissionIds } },
      data: { status: "revoked", revokedAt: new Date() },
    });
  }
});

test("named operators can issue a link and an unapproved or shared session cannot", async () => {
  const env = routeEnv();
  assert.equal(env.SA360_SMS_NOTIFICATIONS_ENABLED, undefined);
  const sam = await ensureOperator({
    email: "sam@lifeagentlaunch.com",
    permission: "admin_coc",
    subject: "sms-operator-sam",
  });
  const matt = await ensureOperator({
    email: "matt@lifeagentlaunch.com",
    permission: "team_workspace",
    subject: "sms-operator-matt",
  });
  const outsider = await ensureOperator({
    email: "pat@lifeagentlaunch.com",
    permission: "team_workspace",
    subject: "sms-operator-pat",
  });
  const clientAccountId = await createClient();
  const app = Fastify();
  await app.register(adminSmsVerbalConsentRoutes, { prefix: "/admin/v1", env });
  const link = `/admin/v1/team-workspace/clients/${clientAccountId}/sms-opt-in-link`;
  const statusUrl = `/admin/v1/team-workspace/clients/${clientAccountId}/sms-consent-status`;

  const shared = await app.inject({
    method: "POST",
    url: link,
    headers: { "content-type": "application/json", "x-sa360-admin-key": ADMIN_KEY },
    payload: { phoneE164: "+15555550121", confirmationEmail: "sandbox@lifeagentlaunch.invalid" },
  });
  assert.equal(shared.statusCode, 403);

  const invalid = await app.inject({
    method: "GET",
    url: statusUrl,
    headers: {
      "x-sa360-admin-key": ADMIN_KEY,
      [STAFF_ASSERTION_HEADER]: signStaffAssertion({ staffPrincipalId: sam, secret: `${SECRET}-other` }).token,
    },
  });
  assert.equal(invalid.statusCode, 401);

  const blocked = await app.inject({
    method: "POST",
    url: link,
    headers: adminHeaders(outsider),
    payload: { phoneE164: "+15555550121", confirmationEmail: "sandbox@lifeagentlaunch.invalid" },
  });
  assert.equal(blocked.statusCode, 403);

  const status = await app.inject({ method: "GET", url: statusUrl, headers: adminHeaders(sam) });
  assert.equal(status.statusCode, 200);
  const before = status.json() as { recipientConsentConfirmed: boolean; smsEnabled: boolean };
  assert.equal(before.recipientConsentConfirmed, false);
  assert.equal(before.smsEnabled, false);

  const issued = await app.inject({
    method: "POST",
    url: link,
    headers: adminHeaders(sam),
    payload: { phoneE164: "+15555550121", confirmationEmail: "sandbox@lifeagentlaunch.invalid" },
  });
  assert.equal(issued.statusCode, 200);
  const body = issued.json() as { smsEnabled: boolean; consentRecorded: boolean; email: string; url: string | null };
  assert.equal(body.smsEnabled, false);
  assert.equal(body.consentRecorded, false);
  assert.equal(body.email, "email_not_configured");
  const token = new URL(body.url ?? "").pathname.split("/").pop() ?? "";
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);

  const mattStatus = await app.inject({ method: "GET", url: statusUrl, headers: adminHeaders(matt) });
  assert.equal(mattStatus.statusCode, 200);
  assert.equal((mattStatus.json() as { smsEnabled: boolean }).smsEnabled, false);

  const stored = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } });
  assert.equal(stored.smsEnabled, false);
  assert.equal(stored.smsConsentRecordedAt, null);
  assert.equal(stored.smsVerbalOperatorId, null);

  const pub = Fastify();
  await pub.register(publicSmsOptInRoutes, { env });
  const unaffirmed = await pub.inject({
    method: "POST",
    url: `/public/sms-opt-in/${token}`,
    headers: { "content-type": "application/json" },
    payload: {},
  });
  assert.equal(unaffirmed.statusCode, 400);
  assert.equal((unaffirmed.json() as { error: string }).error, "consent_not_affirmed");
  const stillOff = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } });
  assert.equal(stillOff.smsEnabled, false);
  assert.equal(stillOff.smsConsentRecordedAt, null);

  await prisma.staffPrincipal.update({
    where: { id: sam },
    data: { status: "disabled", disabledAt: new Date() },
  });
  const disabled = await app.inject({ method: "GET", url: statusUrl, headers: adminHeaders(sam) });
  assert.equal(disabled.statusCode, 403);
  await prisma.staffPrincipal.update({
    where: { id: sam },
    data: { status: "active", disabledAt: null },
  });

  await app.close();
  await pub.close();
});

function adminHeaders(staffPrincipalId: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-sa360-admin-key": ADMIN_KEY,
    [STAFF_ASSERTION_HEADER]: signStaffAssertion({ staffPrincipalId, secret: SECRET }).token,
  };
}

async function createClient(): Promise<string> {
  const clientAccountId = `sms_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await prisma.clientAccount.create({
    data: {
      clientAccountId,
      clientDisplayName: "SMS operator sandbox",
      status: "onboarding",
      portalEnabled: false,
      portalSessionEpoch: 0,
    },
  });
  clientIds.push(clientAccountId);
  return clientAccountId;
}

async function ensureOperator(input: {
  email: string;
  permission: "admin_coc" | "team_workspace";
  subject: string;
}): Promise<string> {
  const existing = await prisma.staffPrincipal.findUnique({ where: { email: input.email } });
  const principal = existing
    ? await prisma.staffPrincipal.update({
        where: { id: existing.id },
        data: {
          status: "active",
          disabledAt: null,
          provider: "google",
          providerSubject: existing.providerSubject ?? input.subject,
          emailVerified: true,
        },
      })
    : await prisma.staffPrincipal.create({
        data: {
          email: input.email,
          emailVerified: true,
          provider: "google",
          providerSubject: input.subject,
          status: "active",
          disabledAt: null,
        },
      });
  const grant = await prisma.staffPermission.findFirst({
    where: { staffPrincipalId: principal.id, permission: input.permission, status: "granted", revokedAt: null },
  });
  if (!grant) {
    const created = await prisma.staffPermission.create({
      data: { staffPrincipalId: principal.id, permission: input.permission, status: "granted" },
    });
    createdPermissionIds.push(created.id);
  }
  return principal.id;
}
