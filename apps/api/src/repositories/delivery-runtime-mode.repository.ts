import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";

const SETTING_ID = "default";

export async function findDeliveryRuntimeModeSetting() {
  try {
    return await prisma.deliveryRuntimeModeSetting.findUnique({ where: { id: SETTING_ID } });
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: string }).code)
        : "";
    if (code === "P2021") return null;
    throw err;
  }
}

export async function upsertDeliveryRuntimeModeSetting(
  data: Omit<Prisma.DeliveryRuntimeModeSettingUpdateInput, "id"> & {
    configuredRuntimeMode: string;
  }
) {
  return prisma.deliveryRuntimeModeSetting.upsert({
    where: { id: SETTING_ID },
    create: {
      id: SETTING_ID,
      configuredRuntimeMode: data.configuredRuntimeMode,
      liveCanaryEnabledUntil:
        data.liveCanaryEnabledUntil === undefined
          ? null
          : (data.liveCanaryEnabledUntil as Date | null),
      enabledBy: data.enabledBy === undefined ? null : (data.enabledBy as string | null),
      enabledAt: data.enabledAt === undefined ? null : (data.enabledAt as Date | null),
      reason: data.reason === undefined ? null : (data.reason as string | null),
    },
    update: data,
  });
}

export async function createDeliveryRuntimeModeAuditEvent(
  data: Prisma.DeliveryRuntimeModeAuditEventCreateInput
) {
  return prisma.deliveryRuntimeModeAuditEvent.create({ data });
}
