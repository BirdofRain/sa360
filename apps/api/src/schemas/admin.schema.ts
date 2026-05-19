import { z } from "zod";
import { WebhookRequestSource } from "@prisma/client";

const isoDateString = z
  .string()
  .min(1)
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: "Invalid ISO date" });

export const adminSummaryQuerySchema = z
  .object({
    from: isoDateString.optional(),
    to: isoDateString.optional(),
  })
  .strict();

export type AdminSummaryQuery = z.infer<typeof adminSummaryQuerySchema>;

/**
 * Default: last 7 days ending now when both omitted.
 * Only `from`: through now. Only `to`: 7 days ending at `to`.
 */
export function resolveSummaryDateRange(fromStr?: string, toStr?: string): { from: Date; to: Date } {
  const now = new Date();
  if (fromStr && toStr) {
    const from = new Date(fromStr);
    const to = new Date(toStr);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new RangeError("invalid date");
    }
    if (from > to) throw new RangeError("from after to");
    return { from, to };
  }
  if (fromStr && !toStr) {
    const from = new Date(fromStr);
    if (Number.isNaN(from.getTime())) throw new RangeError("invalid from");
    return { from, to: now };
  }
  if (!fromStr && toStr) {
    const to = new Date(toStr);
    if (Number.isNaN(to.getTime())) throw new RangeError("invalid to");
    const from = new Date(to.getTime());
    from.setUTCDate(from.getUTCDate() - 7);
    return { from, to };
  }
  const to = now;
  const from = new Date(to.getTime());
  from.setUTCDate(from.getUTCDate() - 7);
  return { from, to };
}

export const webhookListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().optional(),
    source: z.nativeEnum(WebhookRequestSource).optional(),
    processingStatus: z.string().optional(),
    clientAccountId: z.string().optional(),
    subaccountIdGhl: z.string().optional(),
    eventUuid: z.string().optional(),
    eventNameInternal: z.string().optional(),
    httpStatus: z.coerce.number().int().optional(),
    from: isoDateString.optional(),
    to: isoDateString.optional(),
    sortBy: z.literal("receivedAt").optional().default("receivedAt"),
    sortDirection: z.enum(["asc", "desc"]).optional().default("desc"),
  })
  .strict();

export type WebhookListQuery = z.infer<typeof webhookListQuerySchema>;

export const synthflowListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().optional(),
    processingStatus: z.string().optional(),
    lookupStatus: z.string().optional(),
    knownCaller: z.string().optional(),
    matchedBy: z.string().optional(),
    fromNumber: z.string().optional(),
    toNumber: z.string().optional(),
    phoneE164: z.string().optional(),
    modelId: z.string().optional(),
    clientAccountId: z.string().optional(),
    subaccountIdGhl: z.string().optional(),
    httpStatus: z.coerce.number().int().optional(),
    from: isoDateString.optional(),
    to: isoDateString.optional(),
  })
  .strict();

export type SynthflowListQuery = z.infer<typeof synthflowListQuerySchema>;

export const synthflowOutboundResultListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().optional(),
    outcome: z.string().optional(),
    clientAccountId: z.string().optional(),
    subaccountIdGhl: z.string().optional(),
    contactIdGhl: z.string().optional(),
    callId: z.string().optional(),
    modelId: z.string().optional(),
    from: isoDateString.optional(),
    to: isoDateString.optional(),
  })
  .strict();

export type SynthflowOutboundResultListQuery = z.infer<
  typeof synthflowOutboundResultListQuerySchema
>;

export const adminIdParamSchema = z.object({
  id: z.string().min(1),
});
