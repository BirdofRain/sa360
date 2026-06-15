import Link from "next/link";
import { notFound } from "next/navigation";

import { ClientDeliveryConfigPanel } from "@/components/clients/client-delivery-config-panel";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { fetchAdminClientDeliveryConfig, isAdminApiConfigured } from "@/lib/admin-api/server";
import { parseClientDeliveryConfigSearchParams } from "@/lib/clients/delivery-config-query";

export default async function ClientDeliveryConfigPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientAccountId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { clientAccountId } = await params;
  const sp = await searchParams;
  const id = decodeURIComponent(clientAccountId);
  const { locationId } = parseClientDeliveryConfigSearchParams(sp);

  if (!isAdminApiConfigured()) {
    return (
      <div className="space-y-4">
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY to load destination configuration.
        </WarningBanner>
      </div>
    );
  }

  const { data, error } = await fetchAdminClientDeliveryConfig(id, locationId || undefined);
  if (error?.toLowerCase().includes("not found")) notFound();
  if (error || !data) {
    return (
      <div className="space-y-4">
        <WarningBanner tone="warn" title="Could not load destination configuration">
          {error ?? "Unknown error"}
        </WarningBanner>
        <Link href={`/clients/${encodeURIComponent(id)}`} className="text-sm text-sky-700 hover:underline">
          Back to client profile
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/clients/${encodeURIComponent(id)}`}
          className="text-xs text-sky-700 hover:underline"
        >
          ← {data.clientDisplayName}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">GHL destination configuration</h1>
        <p className="font-mono text-sm text-muted-foreground">{data.clientAccountId}</p>
      </div>
      <ClientDeliveryConfigPanel initialSummary={data} />
    </div>
  );
}
