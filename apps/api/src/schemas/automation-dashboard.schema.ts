import { z } from "zod";

const isoDateString = z
  .string()
  .min(1)
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: "Invalid ISO date" });

export const automationDashboardRangeSchema = z.enum(["today", "7d", "30d"]);

export type AutomationDashboardRange = z.infer<typeof automationDashboardRangeSchema>;

export const automationDashboardQuerySchema = z
  .object({
    clientAccountId: z.string().trim().min(1).max(128).optional(),
    locationId: z.string().trim().min(1).max(128).optional(),
    subaccountIdGhl: z.string().trim().min(1).max(128).optional(),
    from: isoDateString.optional(),
    to: isoDateString.optional(),
    range: automationDashboardRangeSchema.optional(),
    nicheKey: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

export type AutomationDashboardQuery = z.infer<typeof automationDashboardQuerySchema>;

export type AutomationDashboardFilters = {
  clientAccountId?: string;
  subaccountIdGhl?: string;
  nicheKey?: string;
  from: Date;
  to: Date;
};

function utcStartOfDay(d: Date): Date {
  const x = new Date(d.getTime());
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

/** Resolve `[from, to]` from explicit ISO dates, `range`, or default 7d ending now. */
export function resolveAutomationDashboardDateRange(
  q: Pick<AutomationDashboardQuery, "from" | "to" | "range">
): { from: Date; to: Date } {
  const now = new Date();

  if (q.from && q.to) {
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new RangeError("invalid date");
    }
    if (from > to) throw new RangeError("from after to");
    return { from, to };
  }

  if (q.from && !q.to) {
    const from = new Date(q.from);
    if (Number.isNaN(from.getTime())) throw new RangeError("invalid from");
    return { from, to: now };
  }

  if (!q.from && q.to) {
    const to = new Date(q.to);
    if (Number.isNaN(to.getTime())) throw new RangeError("invalid to");
    const from = new Date(to.getTime());
    const days = q.range === "30d" ? 30 : q.range === "today" ? 0 : 7;
    if (q.range === "today") {
      return { from: utcStartOfDay(to), to };
    }
    from.setUTCDate(from.getUTCDate() - days);
    return { from, to };
  }

  const to = now;
  if (q.range === "today") {
    return { from: utcStartOfDay(now), to };
  }
  const from = new Date(to.getTime());
  const days = q.range === "30d" ? 30 : 7;
  from.setUTCDate(from.getUTCDate() - days);
  return { from, to };
}

export function toAutomationDashboardFilters(
  q: AutomationDashboardQuery
): AutomationDashboardFilters {
  const { from, to } = resolveAutomationDashboardDateRange(q);
  return {
    clientAccountId: q.clientAccountId,
    subaccountIdGhl: q.locationId ?? q.subaccountIdGhl,
    nicheKey: q.nicheKey,
    from,
    to,
  };
}
