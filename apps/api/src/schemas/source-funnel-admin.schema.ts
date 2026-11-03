import { z } from "zod";

const clientAccountIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/, "clientAccountId must be lowercase slug (a-z, 0-9, _)");

export const associateSourceFunnelBodySchema = z
  .object({
    pageUrlOrSlug: z.string().trim().min(1, "Enter a LeadCapture page URL or slug.").max(500),
  })
  .strict();

export const reassignSourceFunnelBodySchema = z
  .object({
    originClientAccountId: clientAccountIdSchema,
  })
  .strict();

export const confirmSourceFunnelBodySchema = z
  .object({
    originClientAccountId: clientAccountIdSchema,
  })
  .strict();

export const sourceFunnelIdParamSchema = z
  .object({
    sourceFunnelId: z.string().trim().min(1).max(80),
  })
  .strict();

export const observedSourceFunnelsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();

/** Full source catalog. Limit above 50 fails closed instead of being clamped. */
export const sourceFunnelCatalogQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).optional().default(25),
    cursor: z.string().trim().min(1).max(80).optional(),
  })
  .strict();
