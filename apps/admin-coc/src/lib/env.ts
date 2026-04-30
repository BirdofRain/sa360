/**
 * Public env only — never put secrets in NEXT_PUBLIC_*.
 * STAGING | PRODUCTION badge reads from here (default STAGING when unset).
 */
export type Sa360PublicEnv = "development" | "staging" | "production";

export function getPublicSa360Env(): Sa360PublicEnv {
  const raw = process.env.NEXT_PUBLIC_SA360_ENV?.trim().toLowerCase();
  if (raw === "production" || raw === "prod") return "production";
  if (raw === "staging" || raw === "stage") return "staging";
  return "development";
}

export function isProductionBadge(): boolean {
  return getPublicSa360Env() === "production";
}
