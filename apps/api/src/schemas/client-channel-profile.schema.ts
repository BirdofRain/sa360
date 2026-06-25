import { z } from "zod";
import {
  CLIENT_CHANNEL_AI_PROVIDERS,
  CLIENT_CHANNEL_APPLY_SCOPES,
  CLIENT_CHANNEL_DEFAULT_LEAD_CHANNELS,
  CLIENT_CHANNEL_FALLBACK_CHANNELS,
  CLIENT_CHANNEL_HEALTH_STATUSES,
  CLIENT_CHANNEL_PREFERRED_CONTACT_WINDOWS,
  CLIENT_CHANNEL_WRITE_MODES,
} from "../services/client-channel-profile/client-channel-profile.constants.js";

const subaccountIdSchema = z.string().trim().max(120).optional();
const phoneNumberSchema = z.string().trim().min(1).max(40).nullable().optional();
const hourSchema = z.number().int().min(0).max(23);
const positiveCount = z.number().int().min(0).max(1000);

export const clientChannelProfileQuerySchema = z.object({
  subaccountIdGhl: subaccountIdSchema,
});

export const clientChannelProfileSaveBodySchema = z
  .object({
    subaccountIdGhl: subaccountIdSchema,
    blueEnabled: z.boolean().optional(),
    greenEnabled: z.boolean().optional(),
    voiceEnabled: z.boolean().optional(),
    closebotEnabled: z.boolean().optional(),
    ghlAiEnabled: z.boolean().optional(),
    aiProvider: z.enum(CLIENT_CHANNEL_AI_PROVIDERS).optional(),
    defaultLeadChannel: z.enum(CLIENT_CHANNEL_DEFAULT_LEAD_CHANNELS).optional(),
    fallbackChannel: z.enum(CLIENT_CHANNEL_FALLBACK_CHANNELS).optional(),
    requiresSameNumberContinuity: z.boolean().optional(),
    blueNumber: phoneNumberSchema,
    greenNumber: phoneNumberSchema,
    voiceNumber: phoneNumberSchema,
    blueHealthStatus: z.enum(CLIENT_CHANNEL_HEALTH_STATUSES).nullable().optional(),
    greenHealthStatus: z.enum(CLIENT_CHANNEL_HEALTH_STATUSES).nullable().optional(),
    sendblueMaxNoReplyAttempts: positiveCount.optional(),
    sendblueWindowDays: positiveCount.optional(),
    textStartHour: hourSchema.optional(),
    textEndHour: hourSchema.optional(),
    preferredContactWindow: z.enum(CLIENT_CHANNEL_PREFERRED_CONTACT_WINDOWS).optional(),
    applyDefaultScope: z.enum(CLIENT_CHANNEL_APPLY_SCOPES).optional(),
    writeMode: z.enum(CLIENT_CHANNEL_WRITE_MODES).optional(),
  })
  .strict();

export type ClientChannelProfileSaveBody = z.infer<typeof clientChannelProfileSaveBodySchema>;
export type ClientChannelProfileQuery = z.infer<typeof clientChannelProfileQuerySchema>;
