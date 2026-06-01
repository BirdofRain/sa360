import Link from "next/link";
import { notFound } from "next/navigation";

import { ClientDetailPanel } from "@/components/clients/client-detail-panel";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { fetchAdminClientDetail, isAdminApiConfigured } from "@/lib/admin-api/server";
import { getDefaultMasterClientAccountId } from "@/lib/clients/master-client-default";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ clientAccountId: string }>;
}) {
  const { clientAccountId } = await params;
  const id = decodeURIComponent(clientAccountId);

  if (!isAdminApiConfigured()) {
    return (
      <div className="space-y-4">
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY to load client detail.
        </WarningBanner>
      </div>
    );
  }

  const { data, error } = await fetchAdminClientDetail(id);
  if (error) {
    return (
      <div className="space-y-4">
        <WarningBanner tone="warn" title="Could not load client">
          {error}
        </WarningBanner>
        <Link href="/clients" className="text-sm text-sky-700 hover:underline">
          Back to clients
        </Link>
      </div>
    );
  }

  if (!data?.item) notFound();

  return (
    <div className="space-y-4">
      <div>
        <Link href="/clients" className="text-xs text-sky-700 hover:underline">
          ← All clients
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{data.item.clientDisplayName}</h1>
        <p className="font-mono text-sm text-muted-foreground">{data.item.clientAccountId}</p>
      </div>
      <ClientDetailPanel
        initialClient={data.item}
        defaultMasterClientAccountId={getDefaultMasterClientAccountId()}
      />
    </div>
  );
}
