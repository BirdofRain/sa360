/**
 * Admin API paths a Google staff session may call after its permission check.
 * The admin API key is attached only when this returns true.
 * Delivery activation, correction, and command-center diagnostics are absent.
 */

const CLIENT_ID = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}";

const WORKSPACE_READS = [
  /^\/admin\/v1\/clients$/,
  new RegExp(`^/admin/v1/clients/${CLIENT_ID}$`),
  new RegExp(`^/admin/v1/clients/${CLIENT_ID}/setup$`),
  new RegExp(`^/admin/v1/clients/${CLIENT_ID}/onboarding$`),
  new RegExp(`^/admin/v1/clients/${CLIENT_ID}/source-funnels$`),
  new RegExp(`^/admin/v1/clients/${CLIENT_ID}/source-campaign-requests$`),
  new RegExp(`^/admin/v1/clients/${CLIENT_ID}/ghl-destination-configuration$`),
  new RegExp(`^/admin/v1/clients/${CLIENT_ID}/company-sheets-destination-configuration$`),
  new RegExp(`^/admin/v1/team-workspace/clients/${CLIENT_ID}$`),
  new RegExp(`^/admin/v1/team-workspace/clients/${CLIENT_ID}/source-campaign-review$`),
];

const MANAGER_WRITES: Array<{ method: string; pattern: RegExp }> = [
  { method: "POST", pattern: /^\/admin\/v1\/clients$/ },
  { method: "PATCH", pattern: new RegExp(`^/admin/v1/clients/${CLIENT_ID}$`) },
  { method: "PATCH", pattern: new RegExp(`^/admin/v1/clients/${CLIENT_ID}/setup$`) },
  { method: "POST", pattern: new RegExp(`^/admin/v1/clients/${CLIENT_ID}/source-campaign-requests$`) },
  { method: "POST", pattern: new RegExp(`^/admin/v1/clients/${CLIENT_ID}/ghl-destination-configuration$`) },
  { method: "POST", pattern: new RegExp(`^/admin/v1/clients/${CLIENT_ID}/company-sheets-destination-configuration$`) },
];

export type WorkspaceApiPermission = "team_workspace" | "team_manager" | "team_operations";

export function staffWorkspaceAdminApiAllowed(
  permissions: readonly WorkspaceApiPermission[],
  method: string,
  path: string
): boolean {
  const pathname = adminPathname(path);
  if (!pathname) return false;
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD") {
    if (!permissions.includes("team_workspace")) return false;
    return WORKSPACE_READS.some((pattern) => pattern.test(pathname));
  }
  if (!permissions.includes("team_manager")) return false;
  return MANAGER_WRITES.some((entry) => entry.method === upper && entry.pattern.test(pathname));
}

function adminPathname(path: string): string | null {
  const withoutQuery = path.split("?")[0] ?? "";
  if (!withoutQuery.startsWith("/admin/v1/") || withoutQuery.includes("..") || withoutQuery.includes("//")) return null;
  let decoded = withoutQuery;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    return null;
  }
  if (decoded !== withoutQuery || decoded.includes("..") || /\s/.test(decoded)) return null;
  return decoded;
}
