export function routingDryRunEmptyHint(opts: {
  configured: boolean;
  hasMaster: boolean;
  hasApiError: boolean;
  itemCount: number;
  matchedFilter: "all" | "matched" | "unmatched";
}): string | null {
  if (!opts.configured || opts.hasApiError || !opts.hasMaster) return null;
  if (opts.itemCount > 0) return null;
  if (opts.matchedFilter !== "all") {
    return "No decisions match this filter.";
  }
  return "No routing dry-run decisions yet. New lead_created events will appear here after routing rules are seeded.";
}
