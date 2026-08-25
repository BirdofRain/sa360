/**
 * Client Portal module — customer-facing /portal dashboard, orders, leads, and account.
 */

export type { ClientPortalDashboard, ClientPortalRangeKey } from "@/lib/client-portal/types";
export { buildMockClientPortalDashboard } from "@/lib/client-portal/mock-data";
export { mapClientPortalDashboard } from "@/lib/client-portal/map-client-dashboard";
export { parseClientPortalRange } from "@/lib/client-portal/range";
