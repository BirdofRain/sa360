import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PortalAppFrame } from "@/components/client-portal/portal-app-frame";
import { PortalJourneyHome } from "@/components/client-portal/portal-journey-home";
import { firstPortalSearchParam } from "@/lib/client-portal/portal-lead-list-status";
import {
  parsePortalJourneyPreviewScenario,
  PORTAL_JOURNEY_PREVIEW_SCENARIOS,
  portalJourneyPreviewModel,
} from "@/lib/client-portal/portal-journey-fixtures";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Portal journey preview",
  description: "Local fixtures for the customer next-action home page.",
};

const SCENARIO_LABELS: Record<(typeof PORTAL_JOURNEY_PREVIEW_SCENARIOS)[number], string> = {
  onboarding: "Complete account",
  no_order: "Place first order",
  payment_pending: "Payment pending",
  submitted_confirmed: "In review",
  approved: "Approved",
  active_zero: "0 of 25",
  active_partial: "17 of 25",
  fulfilled: "Finalizing",
  completed: "Complete",
  multiple: "Multiple orders",
  account_error: "Account failed",
  orders_error: "Orders failed",
};

export default async function PortalJourneyPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const sp = await searchParams;
  const scenario = parsePortalJourneyPreviewScenario(firstPortalSearchParam(sp.scenario));
  const model = portalJourneyPreviewModel(scenario);

  return (
    <PortalAppFrame displayName="Northwind">
      <div className="space-y-4">
        <p className="rounded-lg border border-sky-100 bg-sky-50/80 px-3 py-2 text-xs text-sky-800">
          Local journey fixtures — not live account data.
        </p>
        <nav className="flex flex-wrap gap-2" aria-label="Journey fixtures">
          {PORTAL_JOURNEY_PREVIEW_SCENARIOS.map((key) => (
            <Link
              key={key}
              href={`/dev/portal-journey?scenario=${encodeURIComponent(key)}`}
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
        <PortalJourneyHome model={model} displayName="Northwind" />
      </div>
    </PortalAppFrame>
  );
}
