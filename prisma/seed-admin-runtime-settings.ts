import {
  PrismaClient,
  type AdminRuntimeSettingEnvironment,
} from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Safe default runtime settings, seeded at GLOBAL scope for every environment.
 * Every default is the most conservative (non-live) option, so seeding can never
 * escalate behavior. Secrets are never seeded here.
 */
const SAFE_DEFAULTS: Array<{ key: string; value: string; description: string }> = [
  {
    key: "ghl.delivery_mode",
    value: "simulate",
    description: "GHL lead delivery execution mode (safe default: simulate).",
  },
  {
    key: "meta.dispatch_mode",
    value: "disabled",
    description: "Meta CAPI dispatch mode (safe default: disabled).",
  },
  {
    key: "routing.mode",
    value: "dry_run",
    description: "Routing execution mode (safe default: dry_run).",
  },
  {
    key: "backup_sheet_export.mode",
    value: "disabled",
    description: "Backup sheet export mode (safe default: disabled).",
  },
];

const ENVIRONMENTS: AdminRuntimeSettingEnvironment[] = ["STAGING", "PRODUCTION"];

async function main() {
  let created = 0;
  let skipped = 0;

  for (const environment of ENVIRONMENTS) {
    for (const def of SAFE_DEFAULTS) {
      const existing = await prisma.adminRuntimeSetting.findFirst({
        where: {
          key: def.key,
          scope: "GLOBAL",
          environment,
          clientAccountId: null,
          subaccountIdGhl: null,
        },
        select: { id: true },
      });

      if (existing) {
        // Never overwrite an operator-set value during seed.
        skipped++;
        continue;
      }

      await prisma.adminRuntimeSetting.create({
        data: {
          key: def.key,
          value: def.value,
          scope: "GLOBAL",
          environment,
          description: def.description,
          reason: "Seeded safe default.",
          updatedBy: "seed",
        },
      });
      created++;
    }
  }

  console.log(
    `Admin runtime settings seed complete: created=${created}, skipped(existing)=${skipped}`
  );
}

main()
  .catch((err) => {
    console.error("Admin runtime settings seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
