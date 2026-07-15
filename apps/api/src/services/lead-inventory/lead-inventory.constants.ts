import type { LeadAgeBandDefinition } from "@prisma/client";

import { LEAD_INVENTORY_AGE_BAND_VERSION } from "@sa360/shared";

export const LEAD_INVENTORY_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

export const LEAD_INVENTORY_ACTIVE_RESERVATION_STATUSES = [
  "reserved",
  "delivering",
  "review_required",
] as const;

export const LEAD_INVENTORY_DEFAULT_AGE_BAND_VERSION = LEAD_INVENTORY_AGE_BAND_VERSION;

export type LeadInventoryAgeBand = Pick<
  LeadAgeBandDefinition,
  "key" | "label" | "minDaysInclusive" | "maxDaysExclusive" | "sortOrder"
>;

export const DEFAULT_AGE_BANDS_V1: LeadInventoryAgeBand[] = [
  { key: "FRESH_0_7", label: "0–7 days", minDaysInclusive: 0, maxDaysExclusive: 8, sortOrder: 10 },
  { key: "RECENT_8_30", label: "8–30 days", minDaysInclusive: 8, maxDaysExclusive: 31, sortOrder: 20 },
  { key: "AGED_31_60", label: "31–60 days", minDaysInclusive: 31, maxDaysExclusive: 61, sortOrder: 30 },
  { key: "AGED_61_90", label: "61–90 days", minDaysInclusive: 61, maxDaysExclusive: 91, sortOrder: 40 },
  { key: "AGED_91_180", label: "91–180 days", minDaysInclusive: 91, maxDaysExclusive: 181, sortOrder: 50 },
  { key: "AGED_181_365", label: "181–365 days", minDaysInclusive: 181, maxDaysExclusive: 366, sortOrder: 60 },
  { key: "AGED_366_PLUS", label: "366+ days", minDaysInclusive: 366, maxDaysExclusive: null, sortOrder: 70 },
];
