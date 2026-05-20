import { z } from "zod";

const isoDateString = z
  .string()
  .min(1)
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: "Invalid ISO date" });

export const clientPortalRangeSchema = z.enum(["7d", "30d", "mtd"]);

export type ClientPortalRangeKey = z.infer<typeof clientPortalRangeSchema>;

export const clientDashboardQuerySchema = z
  .object({
    from: isoDateString.optional(),
    to: isoDateString.optional(),
    range: clientPortalRangeSchema.optional(),
  })
  .strict();

export type ClientDashboardQuery = z.infer<typeof clientDashboardQuerySchema>;

export type ClientDashboardDateRange = {
  from: Date;
  to: Date;
  rangeKey: ClientPortalRangeKey;
};

function localStartOfDay(d: Date): Date {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

export function rangeLabel(key: ClientPortalRangeKey): string {
  switch (key) {
    case "7d":
      return "Last 7 days";
    case "30d":
      return "Last 30 days";
    case "mtd":
      return "Month to date";
    default:
      return "Last 7 days";
  }
}

/** Resolve portal date range from explicit ISO bounds or range key (default 7d). */
export function resolveClientDashboardDateRange(
  q: Pick<ClientDashboardQuery, "from" | "to" | "range">,
  now = new Date()
): ClientDashboardDateRange {
  const rangeKey = q.range ?? "7d";

  if (q.from && q.to) {
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new RangeError("invalid date");
    }
    if (from > to) throw new RangeError("from after to");
    return { from, to, rangeKey };
  }

  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const from = localStartOfDay(now);

  if (rangeKey === "7d") {
    from.setDate(from.getDate() - 6);
    return { from, to, rangeKey };
  }

  if (rangeKey === "30d") {
    from.setDate(from.getDate() - 29);
    return { from, to, rangeKey };
  }

  from.setDate(1);
  return { from, to, rangeKey };
}
