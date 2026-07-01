import { FoOrdersContent } from "@/components/front-office/orders/fo-orders-content";
import { FoPreviewBanner } from "@/components/front-office/shared/fo-preview-banner";
import { FrontOfficeAuthGate } from "@/components/front-office/shell/front-office-auth-gate";
import { FrontOfficeShell } from "@/components/front-office/shell/front-office-shell";
import { getOrders } from "@/lib/front-office/api/get-orders";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const params = await searchParams;
  return (
    <FrontOfficeAuthGate pathname="/front-office/orders" devRole={params.role}>
      {(session) => <OrdersInner session={session} />}
    </FrontOfficeAuthGate>
  );
}

async function OrdersInner({
  session,
}: {
  session: NonNullable<Awaited<ReturnType<typeof import("@/lib/front-office/role-context").resolveFrontOfficeSession>>>;
}) {
  const data = await getOrders(session.role, { clientAccountId: session.clientAccountId });
  return (
    <FrontOfficeShell
      session={session}
      title="Lead Ordering"
      subtitle="Manage fulfillment orders"
      dataSource={data.dataSource}
    >
      <div className="space-y-4">
        <FoPreviewBanner dataSource={data.dataSource} />
        <FoOrdersContent
          initial={data}
          role={session.role}
          showCreateForm={session.role === "admin" || session.role === "client"}
        />
      </div>
    </FrontOfficeShell>
  );
}
