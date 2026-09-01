/**
 * Local sa360_test-only fixtures for the portal-auth invite→login regression.
 * Synthetic IDs/emails only. Does not change product behavior.
 */
import type { PrismaClient } from "@prisma/client";

export const TENANT_A_CLIENT_ID = "client_portal_authreg_a_20260901";
export const TENANT_B_CLIENT_ID = "client_portal_authreg_b_20260901";
export const TENANT_A_EMAIL = "tenant.a.authreg.20260901@example.test";
export const TENANT_B_EMAIL = "tenant.b.authreg.20260901@example.test";
export const TENANT_A_ORDER_NUMBER = "LO-AUTHREG-A-20260901";
export const TENANT_B_ORDER_NUMBER = "LO-AUTHREG-B-20260901";

export const SHARED_ENV_PASSWORD = "shared-env-regression-20260901";
export const TENANT_A_PW1 = "tenant-a-pw1-authreg-20260901";
export const TENANT_A_PW2 = "tenant-a-pw2-authreg-20260901";
export const ADMIN_TEST_KEY = "authreg-admin-key-20260901";
export const PORTAL_TEST_KEY = "authreg-portal-key-20260901";
export const SESSION_TEST_SECRET = "authreg-session-secret-20260901";

const CLIENT_IDS = [TENANT_A_CLIENT_ID, TENANT_B_CLIENT_ID];

export async function cleanupPortalAuthRegression(db: PrismaClient): Promise<void> {
  const orders = await db.leadOrder.findMany({
    where: {
      OR: [
        { clientAccountId: { in: CLIENT_IDS } },
        { orderNumber: { in: [TENANT_A_ORDER_NUMBER, TENANT_B_ORDER_NUMBER] } },
      ],
    },
    select: { id: true },
  });
  const orderIds = orders.map((row) => row.id);
  if (orderIds.length > 0) {
    await db.leadReplacementRequest.deleteMany({
      where: { OR: [{ leadOrderId: { in: orderIds } }, { clientAccountId: { in: CLIENT_IDS } }] },
    });
    await db.leadDeliveryExportPackage.deleteMany({
      where: { OR: [{ leadOrderId: { in: orderIds } }, { clientAccountId: { in: CLIENT_IDS } }] },
    });
    await db.leadAllocation.deleteMany({
      where: { OR: [{ leadOrderId: { in: orderIds } }, { clientAccountId: { in: CLIENT_IDS } }] },
    });
    await db.leadOrder.deleteMany({ where: { id: { in: orderIds } } });
  }
  await db.clientAccount.deleteMany({
    where: {
      OR: [
        { clientAccountId: { in: CLIENT_IDS } },
        { portalLoginEmail: { in: [TENANT_A_EMAIL, TENANT_B_EMAIL] } },
      ],
    },
  });
}

export async function seedPortalAuthRegressionFixture(db: PrismaClient): Promise<{
  tenantAOrderId: string;
  tenantBOrderId: string;
}> {
  await cleanupPortalAuthRegression(db);

  await db.clientAccount.create({
    data: {
      clientAccountId: TENANT_A_CLIENT_ID,
      clientDisplayName: "Portal Auth Regression Tenant A",
      status: "active",
      portalEnabled: true,
      portalDisplayName: "Tenant A Portal",
      portalLoginEmail: TENANT_A_EMAIL,
      portalPasswordHash: null,
      portalPasswordSetAt: null,
      portalSessionEpoch: 0,
      portalInviteTokenHash: null,
      portalInviteExpiresAt: null,
      primaryNicheKeys: ["vet"],
      primaryProductTypes: ["aged_leads"],
      notes: "Localhost-only portal-auth integrated regression tenant A",
    },
  });

  await db.clientAccount.create({
    data: {
      clientAccountId: TENANT_B_CLIENT_ID,
      clientDisplayName: "Portal Auth Regression Tenant B",
      status: "active",
      portalEnabled: true,
      portalDisplayName: "Tenant B Portal",
      portalLoginEmail: TENANT_B_EMAIL,
      portalPasswordHash: null,
      portalPasswordSetAt: null,
      portalSessionEpoch: 0,
      portalInviteTokenHash: null,
      portalInviteExpiresAt: null,
      primaryNicheKeys: ["vet"],
      primaryProductTypes: ["aged_leads"],
      notes: "Localhost-only portal-auth integrated regression tenant B",
    },
  });

  const orderA = await db.leadOrder.create({
    data: {
      orderNumber: TENANT_A_ORDER_NUMBER,
      clientAccountId: TENANT_A_CLIENT_ID,
      clientDisplayName: "Portal Auth Regression Tenant A",
      status: "active",
      nicheKey: "vet",
      statesJson: ["NC"],
      leadVolume: 1,
      campaignType: "aged",
      crmPackage: "test",
      createdByRole: "admin",
      submittedAt: new Date(),
      activatedAt: new Date(),
      requestedQuantity: 1,
    },
  });

  const orderB = await db.leadOrder.create({
    data: {
      orderNumber: TENANT_B_ORDER_NUMBER,
      clientAccountId: TENANT_B_CLIENT_ID,
      clientDisplayName: "Portal Auth Regression Tenant B",
      status: "active",
      nicheKey: "vet",
      statesJson: ["TX"],
      leadVolume: 1,
      campaignType: "aged",
      crmPackage: "test",
      createdByRole: "admin",
      submittedAt: new Date(),
      activatedAt: new Date(),
      requestedQuantity: 1,
    },
  });

  return { tenantAOrderId: orderA.id, tenantBOrderId: orderB.id };
}
