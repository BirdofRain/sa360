import "server-only";

export function isMetaReviewEnabled(): boolean {
  return (process.env.SA360_META_REVIEW_ENABLED?.trim() ?? "").toLowerCase() === "true";
}
