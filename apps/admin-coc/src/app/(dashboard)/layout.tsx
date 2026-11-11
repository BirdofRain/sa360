import type { ReactNode } from "react";

import { redirect } from "next/navigation";

import { DashboardChrome } from "@/components/shell/dashboard-chrome";
import { isAdminCocPasswordConfigured } from "@/lib/admin-coc-auth";
import { ADMIN_COC_ROLE_ADMIN, ADMIN_COC_ROLE_OBSERVER } from "@/lib/admin-coc-observer-access";
import { readAdminCocAccess } from "@/lib/admin-coc-session-guard";
import { readValidMetaReviewerSession } from "@/lib/meta-reviewer-guard";

/** All dashboard routes read live data from the Fastify admin API; never prerender with build-time env. */
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const adminGateEnabled = isAdminCocPasswordConfigured();
  const access = await readAdminCocAccess();
  if (access.kind === "staff_limited") redirect("/staff");
  if (access.kind === "anonymous" && adminGateEnabled) redirect("/login");
  const sessionRole =
    access.kind === "admin" ? ADMIN_COC_ROLE_ADMIN : access.kind === "observer" ? ADMIN_COC_ROLE_OBSERVER : null;
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
