import type { ReactNode } from "react";

import { DashboardChrome } from "@/components/shell/dashboard-chrome";

/** All dashboard routes read live data from the Fastify admin API; never prerender with build-time env. */
export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardChrome>{children}</DashboardChrome>;
}
