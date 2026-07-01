import { FoDialDeskApp } from "@/components/front-office/dial-desk/fo-dial-desk-app";
import { FoPreviewBanner } from "@/components/front-office/shared/fo-preview-banner";
import { FrontOfficeAuthGate } from "@/components/front-office/shell/front-office-auth-gate";
import { FrontOfficeShell } from "@/components/front-office/shell/front-office-shell";
import { getDialDesk } from "@/lib/front-office/api/get-dial-desk";

export default async function DialDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const params = await searchParams;
  return (
    <FrontOfficeAuthGate pathname="/front-office/dial-desk" devRole={params.role}>
      {(session) => <DialDeskInner session={session} />}
    </FrontOfficeAuthGate>
  );
}

async function DialDeskInner({
  session,
}: {
  session: NonNullable<Awaited<ReturnType<typeof import("@/lib/front-office/role-context").resolveFrontOfficeSession>>>;
}) {
  const data = await getDialDesk(session.role);
  return (
    <FrontOfficeShell
      session={session}
      title="Dial Desk"
      subtitle="Queue, contact, and dispositions"
      dataSource={data?.dataSource ?? "mock"}
    >
      <div className="space-y-4">
        {data ? <FoPreviewBanner dataSource={data.dataSource} /> : null}
        {data ? <FoDialDeskApp data={data} /> : null}
      </div>
    </FrontOfficeShell>
  );
}
