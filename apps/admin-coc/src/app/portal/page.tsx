import { ClientPortalShell } from "@/components/client-portal/client-portal-shell";
import { mapClientPortalDashboard } from "@/lib/client-portal/map-client-dashboard";
import { buildMockClientPortalDashboard } from "@/lib/client-portal/mock-data";
import { parseClientPortalRange } from "@/lib/client-portal/range";

export const dynamic = "force-dynamic";

function firstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const rangeKey = parseClientPortalRange(firstString(sp.range));
  const raw = buildMockClientPortalDashboard(rangeKey);
  const dashboard = mapClientPortalDashboard(raw);

  return <ClientPortalShell dashboard={dashboard} />;
}
