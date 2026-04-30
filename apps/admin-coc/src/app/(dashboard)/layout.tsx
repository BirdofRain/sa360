import type { ReactNode } from "react";

import { DashboardChrome } from "@/components/shell/dashboard-chrome";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardChrome>{children}</DashboardChrome>;
}
