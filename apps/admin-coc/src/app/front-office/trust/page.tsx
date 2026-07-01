import { FoTrustCardGrid } from "@/components/front-office/trust/fo-trust-card-grid";
import { FoPreviewBanner } from "@/components/front-office/shared/fo-preview-banner";
import { FrontOfficeAuthGate } from "@/components/front-office/shell/front-office-auth-gate";
import { FrontOfficeShell } from "@/components/front-office/shell/front-office-shell";
import { getTrustCenter } from "@/lib/front-office/api/get-trust";

export default async function TrustPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const params = await searchParams;
  return (
    <FrontOfficeAuthGate pathname="/front-office/trust" devRole={params.role}>
      {(session) => <TrustInner session={session} />}
    </FrontOfficeAuthGate>
  );
}

async function TrustInner({
  session,
}: {
  session: NonNullable<Awaited<ReturnType<typeof import("@/lib/front-office/role-context").resolveFrontOfficeSession>>>;
}) {
  const data = await getTrustCenter(session.role, session.clientAccountId);
  return (
    <FrontOfficeShell
      session={session}
      title="Trust Verification Center"
      subtitle="Connection and delivery health"
      dataSource={data.dataSource}
    >
      <div className="space-y-4">
        <FoPreviewBanner dataSource={data.dataSource} />
        <FoTrustCardGrid cards={data.cards} />
      </div>
    </FrontOfficeShell>
  );
}
