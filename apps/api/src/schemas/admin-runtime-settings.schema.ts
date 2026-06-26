import { z } from "zod";

const environmentSchema = z.enum(["STAGING", "PRODUCTION"]);
const scopeSchema = z.enum(["GLOBAL", "CLIENT", "SUBACCOUNT"]);

/** Query filters for GET /admin/v1/runtime-settings (list configured + known keys). */
export const runtimeSettingsListQuerySchema = z
  .object({
    environment: environmentSchema.optional(),
    scope: scopeSchema.optional(),
    clientAccountId: z.string().min(1).max(200).optional(),
    subaccountIdGhl: z.string().min(1).max(200).optional(),
    key: z.string().min(1).max(200).optional(),
  })
  .strict();

export type RuntimeSettingsListQuery = z.infer<typeof runtimeSettingsListQuerySchema>;

/** Query params for GET /admin/v1/runtime-settings/resolve (effective values). */
export const runtimeSettingsResolveQuerySchema = z
  .object({
    environment: environmentSchema.optional(),
    clientAccountId: z.string().min(1).max(200).optional(),
    subaccountIdGhl: z.string().min(1).max(200).optional(),
    key: z.string().min(1).max(200).optional(),
  })
  .strict();

export type RuntimeSettingsResolveQuery = z.infer<
  typeof runtimeSettingsResolveQuerySchema
>;
