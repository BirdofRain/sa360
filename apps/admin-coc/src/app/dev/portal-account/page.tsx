import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PortalAccountPreview } from "@/components/client-portal/portal-account-preview";
import { PortalAppFrame } from "@/components/client-portal/portal-app-frame";
import { firstPortalSearchParam } from "@/lib/client-portal/portal-lead-list-status";
import {
  parsePortalAccountPreviewScenario,
  PORTAL_ACCOUNT_PREVIEW_SCENARIOS,
  portalAccountPreviewAccount,
} from "@/lib/client-portal/portal-account-fixtures";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Account preview",
  description: "Local fixtures for the customer account page.",
};

const SCENARIO_LABELS: Record<(typeof PORTAL_ACCOUNT_PREVIEW_SCENARIOS)[number], string> = {
  incomplete: "Complete account",
  complete: "Setup complete",
};

export default async function PortalAccountPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const sp = await searchParams;
  const scenario = parsePortalAccountPreviewScenario(firstPortalSearchParam(sp.scenario));
  const account = portalAccountPreviewAccount(scenario);

  return (
    <PortalAppFrame displayName="Northwind">
      <div className="space-y-4">
        <p className="rounded-lg border border-sky-100 bg-sky-50/80 px-3 py-2 text-xs text-sky-800">
          Local account fixtures — not live account data.
        </p>
        <nav className="flex flex-wrap gap-2" aria-label="Account fixtures">
          {PORTAL_ACCOUNT_PREVIEW_SCENARIOS.map((key) => (
            <Link
              key={key}
              href={`/dev/portal-account?scenario=${encodeURIComponent(key)}`}
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
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Account</h1>
          <p className="mt-1 text-sm text-slate-500">
            Your profile, lead focus, and what to do next.
          </p>
        </div>
        <PortalAccountPreview initialAccount={account} />
      </div>
    </PortalAppFrame>
  );
}
