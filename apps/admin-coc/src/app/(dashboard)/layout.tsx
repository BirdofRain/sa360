import type { ReactNode } from "react";

import { DashboardChrome } from "@/components/shell/dashboard-chrome";
import { isAdminCocPasswordConfigured } from "@/lib/admin-coc-auth";
import { ADMIN_COC_ROLE_ADMIN } from "@/lib/admin-coc-observer-access";
import { readAdminCocSessionRole } from "@/lib/admin-coc-session-guard";
import { readValidMetaReviewerSession } from "@/lib/meta-reviewer-guard";

/** All dashboard routes read live data from the Fastify admin API; never prerender with build-time env. */
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const adminGateEnabled = isAdminCocPasswordConfigured();
  const sessionRole = await readAdminCocSessionRole();
  if (sessionRole !== ADMIN_COC_ROLE_ADMIN) {
    const reviewer = await readValidMetaReviewerSession();
    // Middleware already returns 403. This layout must not render operator
    // pages when that gate is skipped. The review workspace lives outside
    // this layout.
    if (reviewer) {
      return (
        <main className="grid min-h-dvh place-items-center bg-slate-50 p-6">
          <p className="text-sm text-slate-800">Forbidden</p>
        </main>
      );
    }
  }
  return (
    <DashboardChrome adminGateEnabled={adminGateEnabled} sessionRole={sessionRole}>
      {children}
    </DashboardChrome>
  );
}
