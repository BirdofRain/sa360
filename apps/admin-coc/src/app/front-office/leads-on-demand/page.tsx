import { FoPreviewBanner } from "@/components/front-office/shared/fo-preview-banner";
import { FrontOfficeAuthGate } from "@/components/front-office/shell/front-office-auth-gate";
import { FrontOfficeShell } from "@/components/front-office/shell/front-office-shell";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionPanel } from "@/components/dashboard/section-panel";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { getLeadsOnDemandAvailability } from "@/lib/front-office/api/get-leads-on-demand";

export default async function LeadsOnDemandPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const params = await searchParams;
  return (
    <FrontOfficeAuthGate pathname="/front-office/leads-on-demand" devRole={params.role}>
      {(session) => <LeadsOnDemandInner session={session} />}
    </FrontOfficeAuthGate>
  );
}

async function LeadsOnDemandInner({
  session,
}: {
  session: NonNullable<Awaited<ReturnType<typeof import("@/lib/front-office/role-context").resolveFrontOfficeSession>>>;
}) {
  const data = await getLeadsOnDemandAvailability(session.role, {
    clientAccountId: session.clientAccountId,
  });

  return (
    <FrontOfficeShell
      session={session}
      title="Leads on Demand"
      subtitle="Aggregate availability catalog"
      dataSource={data.dataSource}
    >
      <div className="space-y-4">
        <FoPreviewBanner dataSource={data.dataSource} />
        <p className="text-sm text-muted-foreground">
          Read-only availability buckets. No checkout, reservation, or payment in this release.
        </p>
        {data.error ? (
          <WarningBanner tone="warn" title="Availability API unavailable">
            {data.error}
          </WarningBanner>
        ) : null}
        <SectionPanel title="Availability by state and age">
          {data.rows.length === 0 ? (
            <EmptyState
              title="Currently unavailable"
              hint="No client-safe inventory aggregates are available yet."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {data.rows.map((row, index) => (
                <li key={`${row.state}-${row.ageBandLabel}-${index}`} className="rounded-md border px-3 py-2">
                  <div className="font-medium">
                    {row.nicheKey} · {row.state} · {row.ageBandLabel}
                  </div>
                  <div className="text-muted-foreground">
                    {row.inventoryClass} · {row.exclusivityMode} · {row.availabilityLabel}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionPanel>
      </div>
    </FrontOfficeShell>
  );
}
