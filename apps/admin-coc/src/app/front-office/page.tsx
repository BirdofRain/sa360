import { Suspense } from "react";

import { FoDashboardContent } from "@/components/front-office/dashboard/fo-dashboard-content";
import { FrontOfficeAuthGate } from "@/components/front-office/shell/front-office-auth-gate";
import { FrontOfficeShell } from "@/components/front-office/shell/front-office-shell";
import { getDashboard } from "@/lib/front-office/api/get-dashboard";

export default async function FrontOfficeDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const params = await searchParams;
  const pathname = "/front-office";

  return (
    <FrontOfficeAuthGate pathname={pathname} devRole={params.role}>
      {(session) => (
        <FrontOfficeDashboardInner session={session} />
      )}
    </FrontOfficeAuthGate>
  );
}

async function FrontOfficeDashboardInner({
  session,
}: {
  session: Awaited<ReturnType<typeof import("@/lib/front-office/role-context").resolveFrontOfficeSession>>;
}) {
  if (!session) return null;
  const data = await getDashboard(session.role);
  return (
    <FrontOfficeShell
      session={session}
      title="Dashboard"
      subtitle="Operational overview"
      dataSource={data.dataSource}
    >
      <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-slate-200" />}>
        <FoDashboardContent data={data} />
      </Suspense>
    </FrontOfficeShell>
  );
}
