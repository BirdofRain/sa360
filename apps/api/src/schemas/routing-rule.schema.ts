import { z } from "zod";
import { ROUTING_MATCH_TYPES } from "../lib/routing-match-type.js";

const nullableTrimmed = z.string().trim().min(1).nullable().optional();

export const routingRulesAdminListQuerySchema = z.object({
  masterClientAccountId: z.string().trim().min(1).optional(),
  clientAccountId: z.string().trim().min(1).optional(),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

const routingRuleMatchFieldsSchema = z.object({
  masterClientAccountId: z.string().trim().min(1),
  clientAccountId: z.string().trim().min(1),
  clientDisplayName: nullableTrimmed,
  destinationSubaccountIdGhl: z.string().trim().min(1).max(120).optional(),
  locationName: nullableTrimmed,
  nicheKey: nullableTrimmed,
  productType: nullableTrimmed,
  sourcePlatform: nullableTrimmed,
  sourceType: nullableTrimmed,
  campaignId: nullableTrimmed,
  campaignName: nullableTrimmed,
  adsetId: nullableTrimmed,
  adId: nullableTrimmed,
  formId: nullableTrimmed,
  utmCampaign: nullableTrimmed,
  utmContent: nullableTrimmed,
  masterDatasetId: nullableTrimmed,
  matchType: z.enum(ROUTING_MATCH_TYPES),
  keywordPattern: nullableTrimmed,
  priority: z.number().int().min(0).max(10000).optional(),
  active: z.boolean().optional(),
  effectiveStart: z.string().datetime().nullable().optional(),
  effectiveEnd: z.string().datetime().nullable().optional(),
});

export const routingRuleCreateBodySchema = routingRuleMatchFieldsSchema
  .strict()
  .superRefine((data, ctx) => {
    if (data.matchType === "keyword_fallback" && !data.keywordPattern?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "keywordPattern is required for keyword_fallback matchType",
        path: ["keywordPattern"],
      });
    }
    if (data.matchType === "campaign_id" && !data.campaignId?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "campaignId is required for campaign_id matchType",
        path: ["campaignId"],
      });
    }
    if (data.matchType === "adset_id" && !data.adsetId?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "adsetId is required for adset_id matchType",
        path: ["adsetId"],
      });
    }
    if (data.matchType === "ad_id" && !data.adId?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "adId is required for ad_id matchType",
        path: ["adId"],
      });
    }
    if (data.matchType === "utm_campaign" && !data.utmCampaign?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "utmCampaign is required for utm_campaign matchType",
        path: ["utmCampaign"],
      });
    }
    if (
      data.matchType === "form_id_utm_campaign" &&
      !data.formId?.trim() &&
      !data.utmCampaign?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "formId or utmCampaign is required for form_id_utm_campaign matchType",
        path: ["formId"],
      });
    }
  });

export const routingRulePatchBodySchema = routingRuleMatchFieldsSchema
  .partial()
  .omit({ masterClientAccountId: true })
  .strict()
  .superRefine((data, ctx) => {
    if (data.matchType === "keyword_fallback" && data.keywordPattern === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "keywordPattern cannot be null for keyword_fallback",
        path: ["keywordPattern"],
      });
    }
  });

export type RoutingRuleCreateBody = z.infer<typeof routingRuleCreateBodySchema>;
export type RoutingRulePatchBody = z.infer<typeof routingRulePatchBodySchema>;
