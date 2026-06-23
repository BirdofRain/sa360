import Link from "next/link";
import { notFound } from "next/navigation";

import { ClientDetailPanel } from "@/components/clients/client-detail-panel";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Badge } from "@/components/ui/badge";
import {
  fetchAdminClientCutoverReadiness,
  fetchAdminClientDetail,
  isAdminApiConfigured,
} from "@/lib/admin-api/server";
import {
  normalizeCutoverReadinessReport,
  overallStatusBadgeClass,
  overallStatusLabel,
} from "@/lib/clients/cutover-readiness-display";
import { getDefaultMasterClientAccountId } from "@/lib/clients/master-client-default";
import { cn } from "@/lib/utils";

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

  const { data: readinessData } = await fetchAdminClientCutoverReadiness(id);
  const cutoverReport = normalizeCutoverReadinessReport(readinessData?.report);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/clients" className="text-xs text-sky-700 hover:underline">
          ← All clients
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{data.item.clientDisplayName}</h1>
        <p className="font-mono text-sm text-muted-foreground">{data.item.clientAccountId}</p>
      </div>
      {cutoverReport ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
            Cutover readiness
          </span>
          <Badge
            variant="outline"
            className={cn("w-fit", overallStatusBadgeClass(cutoverReport.overallStatus))}
          >
            {overallStatusLabel(cutoverReport.overallStatus)}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {cutoverReport.blockers.length} blocker(s), {cutoverReport.warnings.length} warning(s)
          </span>
          <Link
            href={`/clients/${encodeURIComponent(id)}/delivery-config`}
            className="ml-auto text-xs text-sky-700 hover:underline"
          >
            View full readiness →
          </Link>
        </div>
      ) : null}
      <ClientDetailPanel
        initialClient={data.item}
        defaultMasterClientAccountId={getDefaultMasterClientAccountId()}
      />
    </div>
  );
}
