import Link from "next/link";
import type { ReactNode } from "react";

import { ClientDetailSetupLink } from "@/components/clients/onboarding/client-detail-setup-link";
import { Badge } from "@/components/ui/badge";

export function ClientSetupLoading() {
  return (
    <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700" role="status">
      Loading client setup…
    </p>
  );
}

export function ClientDiagnosticsLoading() {
  return (
    <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700" role="status">
      Loading stored records…
    </p>
  );
}

export function ClientSourceToolsLoading() {
  return (
    <p className="text-sm text-slate-700" role="status">
      Loading source association tools…
    </p>
  );
}

export function StoredRecordsSection({ children }: { children: ReactNode }) {
  return (
    <details data-testid="stored-records" className="rounded-xl border border-slate-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm text-slate-900">
        <span className="font-semibold">Records already stored</span>
        <span className="mt-1 block text-xs font-normal text-slate-600">
          Sources, destinations, cutover status, and provider diagnostics. Open this section to read
          them. A failed read stays unavailable and is not treated as an empty record.
        </span>
      </summary>
      <div className="space-y-4 border-t border-slate-200 p-4">{children}</div>
    </details>
  );
}

export function ClientDetailLayout({
  clientAccountId,
  clientDisplayName,
  statusLabel,
  setupEnabled,
  setup,
  diagnostics,
  advancedSources,
  advancedClient,
}: {
  clientAccountId: string;
  clientDisplayName: string;
  statusLabel: string;
  setupEnabled: boolean;
  setup: ReactNode;
  diagnostics: ReactNode;
  advancedSources: ReactNode;
  advancedClient: ReactNode;
}) {
  const encoded = encodeURIComponent(clientAccountId);
  return (
    <div className="space-y-4">
      <div>
        <Link href="/clients" className="text-xs text-sky-700 hover:underline">
          ← All clients
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{clientDisplayName}</h1>
        <p className="font-mono text-sm text-muted-foreground">{clientAccountId}</p>
        <div className="mt-2">
          <Badge variant="outline">{statusLabel}</Badge>
        </div>
        <nav
          aria-label="Related client pages"
          className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Related pages</p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            <Link href={`/clients/${encoded}/settings`} className="text-sky-700 hover:underline">
              Channel Profile settings
            </Link>
            <Link href={`/clients/${encoded}/delivery-config`} className="text-sky-700 hover:underline">
              GHL destination configuration
            </Link>
            <Link href={`/clients/${encoded}/google-sheets`} className="text-sky-700 hover:underline">
              Company Google Sheets
            </Link>
            <Link href={`/clients/${encoded}/notification-recipient`} className="text-sky-700 hover:underline">
              Delivery notification recipient
            </Link>
            <ClientDetailSetupLink clientAccountId={clientAccountId} />
          </div>
        </nav>
      </div>
      <div data-testid="client-setup-region">{setup}</div>
      <div data-testid="client-diagnostics-region">{diagnostics}</div>
      <details
        id="advanced-configuration"
        open={!setupEnabled}
        data-testid="advanced-configuration"
        className="rounded-xl border border-slate-200 bg-slate-50"
      >
        <summary className="cursor-pointer px-4 py-3 text-sm text-slate-900">
          <span className="font-semibold">Advanced configuration</span>
          <span className="mt-1 block text-xs font-normal text-slate-600">
            Associate sources, confirm ownership, or edit the client record. These tools can write
            operational records. The summary above does not.
          </span>
        </summary>
        <div className="space-y-4 border-t border-slate-200 p-4">
          {advancedSources}
          {advancedClient}
        </div>
      </details>
    </div>
  );
}
