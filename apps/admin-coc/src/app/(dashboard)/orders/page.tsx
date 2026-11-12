import { WarningBanner } from "@/components/dashboard/warning-banner";
import { FoOrdersContent } from "@/components/front-office/orders/fo-orders-content";
import { AdminCocForbiddenError, requireAdminCocAdminSession } from "@/lib/admin-coc-session-guard";
import { loadCocLeadOrders } from "@/lib/coc-orders/load-coc-lead-orders";
import { COC_ORDERS_API } from "@/lib/front-office/api/lead-order-review-client";
import { parseReviewQueueFilter } from "@/lib/front-office/order-review";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && raw.trim() !== "" ? raw : undefined;
}

export default async function CocOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    await requireAdminCocAdminSession();
  } catch (error) {
    if (error instanceof AdminCocForbiddenError) {
      return (
        <main className="grid min-h-[40vh] place-items-center p-6">
          <p className="text-sm text-slate-800">Forbidden</p>
        </main>
      );
    }
    throw error;
  }

  const sp = await searchParams;
  const reviewFilter = parseReviewQueueFilter(firstParam(sp.review));
  const loaded = await loadCocLeadOrders();

  return (
    <div className="space-y-4" data-testid="coc-orders-page">
      <p className="text-sm text-muted-foreground">
        Confirm payment and approve orders in this shell. Activation, reservation, and release stay
        in Fulfillment Ops. The Front Office order list remains at{" "}
        <a className="underline underline-offset-2" href="/front-office/orders">
          /front-office/orders
        </a>
        .
      </p>

      {loaded.truncated ? (
        <WarningBanner tone="info" title="Order list truncated">
          Showing the first 1,000 live orders. Narrow the review queue if an order is missing.
        </WarningBanner>
      ) : null}

      <FoOrdersContent
        initial={{ orders: loaded.orders, dataSource: "live" }}
        role="admin"
        ordersApiBase={COC_ORDERS_API}
        initialError={loaded.error}
        initialReviewFilter={reviewFilter}
      />
    </div>
  );
}
