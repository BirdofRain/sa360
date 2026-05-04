import { WarningBanner } from "@/components/dashboard/warning-banner";
import { fetchAdminSynthflowRequests, isAdminApiConfigured } from "@/lib/admin-api/server";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default async function SynthflowPage() {
  const configured = isAdminApiConfigured();
  const { items, error } = await fetchAdminSynthflowRequests({ limit: 50 });

  return (
    <div className="space-y-4">
      {!configured ? (
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY (or ADMIN_API_KEY) to load Synthflow requests.
        </WarningBanner>
      ) : null}
      {configured && error ? (
        <WarningBanner tone="warn" title="Synthflow request log unavailable">
          {error}
        </WarningBanner>
      ) : null}

      <p className="text-sm text-muted-foreground">
        Inbound lookup rows from GET /admin/v1/synthflow-requests (newest first per API).
      </p>
      <div className="rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Time</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>lookup_status</TableHead>
              <TableHead>known_caller</TableHead>
              <TableHead>matched_by</TableHead>
              <TableHead>contact_id_ghl</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                  {configured && !error ? "No Synthflow requests returned." : "—"}
                </TableCell>
              </TableRow>
            ) : (
              items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs">{formatTime(row.receivedAt)}</TableCell>
                  <TableCell className="max-w-[140px] truncate font-mono text-xs">{row.fromNumber ?? "—"}</TableCell>
                  <TableCell className="max-w-[140px] truncate font-mono text-xs">{row.toNumber ?? "—"}</TableCell>
                  <TableCell className="text-sm">{row.lookupStatus ?? "—"}</TableCell>
                  <TableCell className="text-sm">{row.knownCaller ?? "—"}</TableCell>
                  <TableCell className="text-sm">{row.matchedBy ?? "—"}</TableCell>
                  <TableCell className="max-w-[160px] truncate font-mono text-xs">{row.contactIdGhl ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
