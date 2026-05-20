import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionPanel } from "@/components/dashboard/section-panel";
import type { ClientPortalLeadSource } from "@/lib/client-portal/types";

export function LeadSourcesCard({ sources }: { sources: ClientPortalLeadSource[] }) {
  return (
    <SectionPanel title="Lead sources">
      {sources.length === 0 ? (
        <EmptyState
          title="No source data yet"
          hint="Campaign and source breakdown will appear once leads include attribution."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[320px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium text-right">Leads</th>
                <th className="px-4 py-2 font-medium text-right">Appointments</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {sources.map((row) => (
                <tr key={row.label}>
                  <td className="px-4 py-3 font-medium text-slate-800">{row.label}</td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {row.leadCount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {row.appointmentsSet.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionPanel>
  );
}
