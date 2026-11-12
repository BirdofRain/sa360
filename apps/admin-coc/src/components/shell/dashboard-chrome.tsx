"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { DashboardShell } from "@/components/shell/dashboard-shell";
import type { AdminCocRole } from "@/lib/admin-coc-observer-access";
import { resolvePageMeta } from "@/lib/page-meta";

export function DashboardChrome({
  children,
  adminGateEnabled,
  sessionRole,
  navigation = "admin",
}: {
  children: ReactNode;
  adminGateEnabled: boolean;
  sessionRole: AdminCocRole | null;
  navigation?: "admin" | "observer" | "workspace";
}) {
  const pathname = usePathname();
  const meta = resolvePageMeta(pathname);

  return (
    <DashboardShell
      title={meta.title}
      description={meta.description}
      adminGateEnabled={adminGateEnabled}
      sessionRole={sessionRole}
      navigation={navigation}
    >
      {children}
    </DashboardShell>
  );
}
