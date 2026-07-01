import { FoLeadDeliveryTable } from "@/components/front-office/lead-delivery/fo-lead-delivery-table";
import { FoPreviewBanner } from "@/components/front-office/shared/fo-preview-banner";
import { FrontOfficeAuthGate } from "@/components/front-office/shell/front-office-auth-gate";
import { FrontOfficeShell } from "@/components/front-office/shell/front-office-shell";
import { getLeadDeliveryList } from "@/lib/front-office/api/get-lead-delivery";

export default async function LeadDeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const params = await searchParams;
  return (
    <FrontOfficeAuthGate pathname="/front-office/lead-delivery" devRole={params.role}>
      {(session) => <LeadDeliveryInner session={session} />}
    </FrontOfficeAuthGate>
  );
}

async function LeadDeliveryInner({
  session,
}: {
  session: NonNullable<Awaited<ReturnType<typeof import("@/lib/front-office/role-context").resolveFrontOfficeSession>>>;
}) {
  const data = await getLeadDeliveryList(session.role, session.clientAccountId);
  return (
    <FrontOfficeShell
      session={session}
      title="Lead Delivery Center"
      subtitle="Track delivery status and milestones"
      dataSource={data.dataSource}
    >
      <div className="space-y-4">
        <FoPreviewBanner dataSource={data.dataSource} />
        <FoLeadDeliveryTable rows={data.rows} />
      </div>
    </FrontOfficeShell>
  );
}
