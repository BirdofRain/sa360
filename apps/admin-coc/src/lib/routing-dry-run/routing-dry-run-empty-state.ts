export function routingDryRunEmptyHint(opts: {
  configured: boolean;
  hasApiError: boolean;
  itemCount: number;
  matchedFilter: "all" | "matched" | "unmatched";
  validationStatusFilter: string;
  reviewQueueFilter: string;
}): string | null {
  if (!opts.configured || opts.hasApiError) return null;
  if (opts.itemCount > 0) return null;
  if (
    opts.matchedFilter !== "all" ||
    opts.validationStatusFilter !== "all" ||
    opts.reviewQueueFilter !== "all"
  ) {
    return "No decisions match this filter.";
  }
  return "No routing dry-run decisions yet. New lead_created events will appear here after routing rules are seeded.";
}
