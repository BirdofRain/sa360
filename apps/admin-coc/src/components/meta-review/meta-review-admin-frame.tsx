import type { ReactNode } from "react";

import { DashboardChrome } from "@/components/shell/dashboard-chrome";
import { isAdminCocPasswordConfigured } from "@/lib/admin-coc-auth";
import { ADMIN_COC_ROLE_ADMIN } from "@/lib/admin-coc-observer-access";

/** Operator chrome for /meta-review. Imported only after an admin session is confirmed. */
export function MetaReviewAdminFrame({ children }: { children: ReactNode }) {
  return (
    <DashboardChrome
      adminGateEnabled={isAdminCocPasswordConfigured()}
      sessionRole={ADMIN_COC_ROLE_ADMIN}
    >
      {children}
    </DashboardChrome>
  );
}
