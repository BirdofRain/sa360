import { Card, FilterBar, FilterInput, FilterSelect, SeverityChip, StatusChip } from "../primitives";
import { reviewItems } from "../data";
import { CheckCircle2, UserPlus } from "lucide-react";

export function ReviewQueue() {
  return (
    <div className="space-y-4 p-6">
      <FilterBar>
        <FilterInput placeholder="Search reason, contact, workflow…" />
        <FilterSelect label="Severity" options={["All", "critical", "high", "medium", "low"]} />
        <FilterSelect label="Source" options={["All", "GHL", "Synthflow", "Meta", "Internal"]} />
        <FilterSelect label="Status" options={["Open", "Acknowledged", "Resolved", "All"]} />
        <FilterSelect label="Assigned to" options={["Anyone", "Me", "Renee K.", "Devon M.", "Unassigned"]} />
      </FilterBar>

      <div className="grid grid-cols-3 gap-3">
        {reviewItems.map((r) => (
          <div key={r.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <SeverityChip severity={r.severity} />
              <StatusChip status={r.status} />
            </div>
            <div>
              <div className="text-sm text-slate-900" style={{ fontWeight: 500 }}>{r.reason}</div>
              <div className="mt-0.5 text-xs text-slate-500">{r.client} · {r.subaccount}</div>
            </div>
            <dl className="grid grid-cols-2 gap-1.5 text-[11px]">
              <Pair k="Source" v={r.source} />
              <Pair k="Workflow" v={r.workflow} mono />
              <Pair k="Contact" v={r.contact} mono />
              <Pair k="Created" v={r.ts} />
            </dl>
            <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3">
              <span className="text-[11px] text-slate-500">{r.assigned === "—" ? "Unassigned" : `Assigned · ${r.assigned}`}</span>
              <div className="flex gap-1">
                <button title="Assign" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><UserPlus className="size-3.5" /></button>
                <button className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50">Acknowledge</button>
                <button className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-[11px] text-white hover:bg-slate-800"><CheckCircle2 className="size-3" />Resolve</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Card title="Full queue table">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <Th>Severity</Th><Th>Source</Th><Th>Reason</Th><Th>Client</Th><Th>Subaccount</Th><Th>Contact</Th><Th>Workflow</Th><Th>Status</Th><Th>Assigned</Th><Th>Created</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reviewItems.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <Td><SeverityChip severity={r.severity} /></Td>
                  <Td>{r.source}</Td>
                  <Td className="text-slate-900">{r.reason}</Td>
                  <Td className="text-slate-600">{r.client}</Td>
                  <Td><code className="text-[11px]">{r.subaccount}</code></Td>
                  <Td><code className="text-[11px]">{r.contact}</code></Td>
                  <Td><code className="text-[11px]">{r.workflow}</code></Td>
                  <Td><StatusChip status={r.status} /></Td>
                  <Td className="text-slate-600">{r.assigned}</Td>
                  <Td className="text-slate-500">{r.ts}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Pair({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div className="rounded bg-slate-50 px-2 py-1"><span className="text-slate-400">{k} </span><span className={mono ? "font-mono text-slate-700" : "text-slate-700"}>{v}</span></div>;
}
function Th({ children }: any) { return <th className="px-3 py-2 text-left">{children}</th>; }
function Td({ children, className = "" }: any) { return <td className={`px-3 py-2.5 ${className}`}>{children}</td>; }
