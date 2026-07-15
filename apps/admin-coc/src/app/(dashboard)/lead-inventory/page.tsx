import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionPanel } from "@/components/dashboard/section-panel";
import { StatTile } from "@/components/dashboard/stat-tile";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { loadLeadInventoryPageData } from "@/lib/lead-inventory/lead-inventory-api";

export const dynamic = "force-dynamic";

export default async function LeadInventoryPage() {
  const payload = await loadLeadInventoryPageData();
  const summary = payload.summary;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Lead Inventory</h1>
        <p className="text-sm text-muted-foreground">
          Read-only supply matrix by state and age band. No import, reservation, or delivery actions.
        </p>
      </div>

      {payload.loadError ? (
        <WarningBanner tone="warn" title="Inventory API unavailable">
          {payload.loadError}
        </WarningBanner>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <StatTile label="Available" value={summary?.available ?? 0} />
        <StatTile label="Reserved" value={summary?.reserved ?? 0} />
        <StatTile label="Committed" value={summary?.committed ?? 0} />
        <StatTile label="Active lots" value={summary?.lotsActive ?? 0} />
      </div>

      <SectionPanel title="State-by-age matrix">
        <p className="border-b border-slate-100 px-4 py-2 text-sm text-muted-foreground">
          Available, reserved, and demand overlay by cell.
        </p>
        {payload.facets.length === 0 ? (
          <EmptyState
            title="No inventory cells yet"
            hint="Inventory items will appear here once lots and items are created in a future authorized import."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">Age band</th>
                  <th className="px-3 py-2">Available</th>
                  <th className="px-3 py-2">Reserved</th>
                  <th className="px-3 py-2">Blocked</th>
                  <th className="px-3 py-2">Demand</th>
                  <th className="px-3 py-2">Unmet</th>
                </tr>
              </thead>
              <tbody>
                {payload.facets.map((row) => (
                  <tr key={`${row.state}-${row.ageBandKey}`} className="border-b">
                    <td className="px-3 py-2">{row.state}</td>
                    <td className="px-3 py-2">{row.ageBandLabel}</td>
                    <td className="px-3 py-2">{row.available}</td>
                    <td className="px-3 py-2">{row.reserved}</td>
                    <td className="px-3 py-2">{row.blocked}</td>
                    <td className="px-3 py-2">{row.demand}</td>
                    <td className="px-3 py-2">{row.unmet}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionPanel>

      <SectionPanel title="Lots">
        <p className="border-b border-slate-100 px-4 py-2 text-sm text-muted-foreground">
          Derived lot counts without exposing lead identity.
        </p>
        {payload.lots.length === 0 ? (
          <EmptyState title="No inventory lots" hint="Lots will appear after authorized inventory creation." />
        ) : (
          <ul className="space-y-2 text-sm">
            {payload.lots.map((lot) => (
              <li key={lot.id} className="rounded-md border px-3 py-2">
                <div className="font-medium">{lot.displayName}</div>
                <div className="text-muted-foreground">
                  {lot.status} · total {lot.total} · available {lot.available} · reserved {lot.reserved} · blocked{" "}
                  {lot.blocked}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionPanel>

      {payload.evaluatedAt ? (
        <p className="text-xs text-muted-foreground">Evaluated at {payload.evaluatedAt}</p>
      ) : null}
    </div>
  );
}
