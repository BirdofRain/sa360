import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PortalAppFrame } from "@/components/client-portal/portal-app-frame";
import { PortalOrderDetail } from "@/components/client-portal/portal-order-detail";
import { firstPortalSearchParam } from "@/lib/client-portal/portal-lead-list-status";
import {
  parsePortalOrderFulfillmentPreviewScenario,
  PORTAL_ORDER_FULFILLMENT_PREVIEW_SCENARIOS,
  portalOrderFulfillmentPreviewProps,
} from "@/lib/client-portal/portal-order-fulfillment-fixtures";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Order fulfillment preview",
  description: "Local fixtures for customer portal order fulfillment.",
};

const SCENARIO_LABELS: Record<(typeof PORTAL_ORDER_FULFILLMENT_PREVIEW_SCENARIOS)[number], string> = {
  zero: "0 of 25",
  partial: "5 of 25",
  full: "25 of 25",
  over: "Over-fulfillment",
  unavailable: "Unavailable",
  linked: "Linked leads",
  leads_error: "Leads failed",
};

export default async function PortalOrderFulfillmentPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const sp = await searchParams;
  const scenario = parsePortalOrderFulfillmentPreviewScenario(
    firstPortalSearchParam(sp.scenario)
  );
  const props = portalOrderFulfillmentPreviewProps(scenario);

  return (
    <PortalAppFrame displayName={props.displayName}>
      <div className="space-y-4">
        <p className="rounded-lg border border-sky-100 bg-sky-50/80 px-3 py-2 text-xs text-sky-800">
          Local fulfillment fixtures — not live account data.
        </p>
        <nav className="flex flex-wrap gap-2" aria-label="Fulfillment fixtures">
          {PORTAL_ORDER_FULFILLMENT_PREVIEW_SCENARIOS.map((key) => (
            <Link
              key={key}
              href={`/dev/portal-order-fulfillment?scenario=${encodeURIComponent(key)}`}
              className={`inline-flex min-h-10 items-center rounded-full border px-3 text-sm ${
                key === scenario
                  ? "border-slate-800 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              {SCENARIO_LABELS[key]}
            </Link>
          ))}
        </nav>
        <PortalOrderDetail {...props} />
      </div>
    </PortalAppFrame>
  );
}
