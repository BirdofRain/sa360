import type { ReactNode } from "react";

import { DashboardChrome } from "@/components/shell/dashboard-chrome";
import { isAdminCocPasswordConfigured } from "@/lib/admin-coc-auth";

/** All dashboard routes read live data from the Fastify admin API; never prerender with build-time env. */
export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const adminGateEnabled = isAdminCocPasswordConfigured();
  return (
    <DashboardChrome adminGateEnabled={adminGateEnabled}>{children}</DashboardChrome>
  );
}
