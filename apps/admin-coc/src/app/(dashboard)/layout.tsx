import type { ReactNode } from "react";

import { DashboardChrome } from "@/components/shell/dashboard-chrome";
import { isAdminCocPasswordConfigured } from "@/lib/admin-coc-auth";
import { readAdminCocSessionRole } from "@/lib/admin-coc-session-guard";

/** All dashboard routes read live data from the Fastify admin API; never prerender with build-time env. */
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const adminGateEnabled = isAdminCocPasswordConfigured();
  const sessionRole = await readAdminCocSessionRole();
  return (
    <DashboardChrome adminGateEnabled={adminGateEnabled} sessionRole={sessionRole}>
      {children}
    </DashboardChrome>
  );
}
