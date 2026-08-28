import Link from "next/link";

import { SectionPanel } from "@/components/dashboard/section-panel";
import { formatPortalDate, type PortalOrderView } from "@/lib/client-portal/map-client-orders";
import {
  PORTAL_JOURNEY_COPY,
  portalJourneyRecentStatusLabel,
  type PortalJourneyHero,
  type PortalJourneyHomeModel,
} from "@/lib/client-portal/portal-journey";
import { cn } from "@/lib/utils";

import { PortalOrderIdentity } from "./portal-order-identity";
import { PortalStatusPill } from "./portal-status-pill";

function recentStatusTone(
  label: string
): "good" | "warn" | "bad" | "neutral" {
  if (
    label === "Complete" ||
    label === "Approved" ||
    label === "In progress" ||
    label === "Delivery ready"
  ) {
    return "good";
  }
  if (label === "Canceled") return "bad";
  if (
    label === "Awaiting payment" ||
    label === "Needs setup" ||
    label === "Needs review" ||
    label === "Paused" ||
    label === "Finalizing delivery"
  ) {
    return "warn";
  }
  return "neutral";
}

function JourneyCta({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  const className = cn(
    "inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-white",
    "hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400",
    "md:w-auto"
  );
  if (href.startsWith("/api/")) {
    return (
      <a href={href} className={className}>
        {label}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {label}
    </Link>
  );
}

export function PortalJourneyHeroCard({
  hero,
  displayName,
}: {
  hero: PortalJourneyHero;
  displayName?: string | null;
}) {
  return (
    <section
      aria-labelledby="portal-journey-title"
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_0_rgba(15,23,42,0.04)] sm:p-8"
    >
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            What you need to do
          </p>
          <h1
            id="portal-journey-title"
            className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl"
          >
            {hero.title}
          </h1>
          {hero.orderNumber ? (
            <p className="text-sm text-slate-600">
              <PortalOrderIdentity displayName={displayName} orderNumber={hero.orderNumber} />
            </p>
          ) : null}
          {hero.fulfillmentLabel ? (
            <p className="text-base font-medium tabular-nums text-slate-900">
              {hero.fulfillmentLabel}
            </p>
          ) : null}
          {hero.detail ? (
            <p className="max-w-xl text-sm text-slate-500">{hero.detail}</p>
          ) : null}
        </div>
        {hero.cta ? <JourneyCta href={hero.cta.href} label={hero.cta.label} /> : null}
      </div>
    </section>
  );
}

function RecentOrderRow({
  order,
  displayName,
  isPrimary,
}: {
  order: PortalOrderView;
  displayName?: string | null;
  isPrimary: boolean;
}) {
  const label = portalJourneyRecentStatusLabel(order);
  const date = formatPortalDate(order.createdAt);
  return (
    <li>
      <Link
        href={`/portal/orders/${encodeURIComponent(order.id)}`}
        className={cn(
          "flex min-h-14 flex-col gap-2 rounded-lg px-3 py-3 sm:flex-row sm:items-center sm:justify-between",
          "hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300",
          isPrimary && "bg-slate-50/80"
        )}
      >
        <div className="min-w-0">
          <p className="truncate text-sm text-slate-900">
            <PortalOrderIdentity displayName={displayName} orderNumber={order.orderNumber} />
          </p>
          {date ? <p className="mt-0.5 text-xs text-slate-500">{date}</p> : null}
        </div>
        <PortalStatusPill label={label} tone={recentStatusTone(label)} />
      </Link>
    </li>
  );
}

export function PortalJourneyRecentOrders({
  orders,
  ordersAvailable,
  primaryOrderId,
  displayName,
}: {
  orders: PortalOrderView[];
  ordersAvailable: boolean;
  primaryOrderId: string | null;
  displayName?: string | null;
}) {
  return (
    <SectionPanel
      title="Recent orders"
      action={
        <Link
          href="/portal/orders"
          className="inline-flex min-h-10 items-center text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
        >
          View all orders
        </Link>
      }
    >
      {!ordersAvailable ? (
        <p className="px-4 py-6 text-sm text-slate-500">
          {PORTAL_JOURNEY_COPY.recentOrdersUnavailable}
        </p>
      ) : orders.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">
          {PORTAL_JOURNEY_COPY.recentOrdersEmpty}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 px-1 py-1">
          {orders.map((order) => (
            <RecentOrderRow
              key={order.id}
              order={order}
              displayName={displayName}
              isPrimary={order.id === primaryOrderId}
            />
          ))}
        </ul>
      )}
    </SectionPanel>
  );
}

export function PortalJourneyHome({
  model,
  displayName,
}: {
  model: PortalJourneyHomeModel;
  displayName?: string | null;
}) {
  return (
    <div className="space-y-6">
      <PortalJourneyHeroCard hero={model.hero} displayName={displayName} />
      <PortalJourneyRecentOrders
        orders={model.recentOrders}
        ordersAvailable={model.ordersAvailable}
        primaryOrderId={model.primaryOrderId}
        displayName={displayName}
      />
    </div>
  );
}
