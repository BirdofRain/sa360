import { useState } from "react";
import { Card, FilterBar, FilterInput, FilterSelect, JsonViewer, ResultChip, StatusChip } from "../primitives";
import { webhooks, WebhookRow } from "../data";
import { X } from "lucide-react";

export function WebhookMonitor() {
  const [open, setOpen] = useState<WebhookRow | null>(null);
  return (
    <div className="space-y-4 p-6">
      <FilterBar>
        <FilterInput placeholder="Search event ID, contact, payload…" />
        <FilterSelect label="Source" options={["All sources", "GHL", "Synthflow", "Meta", "Internal"]} />
        <FilterSelect label="Client" options={["All clients", "Liberty Final Expense", "Veteran Benefits Group", "NurseLeads Pro"]} />
        <FilterSelect label="Subaccount" options={["All subaccounts", "loc_3xK29fA", "loc_88aLp02", "loc_kk441z"]} />
        <FilterSelect label="Status" options={["All statuses", "success", "failed", "queued", "retry"]} />
        <FilterSelect label="Event" options={["All events", "lead_created", "appointment_set", "sale_logged", "inbound.lookup", "capi.dispatch"]} />
        <FilterSelect label="Range" options={["Last hour", "Last 24h", "Last 7d", "Custom…"]} />
        <div className="ml-auto flex items-center gap-2">
          <button className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">Reset</button>
          <button className="rounded-md bg-slate-900 px-2.5 py-1 text-xs text-white hover:bg-slate-800">Export CSV</button>
        </div>
      </FilterBar>

      <Card title={`Webhook requests · ${webhooks.length} of 12,481`} action={<span className="text-xs text-slate-400">auto-refresh 5s</span>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <Th>Time</Th><Th>ID</Th><Th>Source</Th><Th>Event</Th><Th>Client</Th><Th>Subaccount</Th><Th>Status</Th><Th>Result</Th><Th className="text-right">Duration</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {webhooks.map((w) => (
                <tr key={w.id} onClick={() => setOpen(w)} className="cursor-pointer hover:bg-slate-50">
                  <Td className="text-slate-500">{w.ts}</Td>
                  <Td><code className="rounded bg-slate-100 px-1 text-[11px]">{w.id}</code></Td>
                  <Td><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">{w.source}</span></Td>
                  <Td><code className="text-[12px] text-slate-800">{w.event}</code></Td>
                  <Td>{w.client}</Td>
                  <Td className="text-slate-500">{w.subaccount}</Td>
                  <Td><StatusChip status={w.status} /></Td>
                  <Td><ResultChip value={w.result} /></Td>
                  <Td className="text-right text-slate-600">{w.duration}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {open && <Drawer row={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Th({ children, className = "" }: any) { return <th className={`px-4 py-2 text-left ${className}`}>{children}</th>; }
function Td({ children, className = "" }: any) { return <td className={`px-4 py-2.5 align-middle ${className}`}>{children}</td>; }

function Drawer({ row, onClose }: { row: WebhookRow; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onClick={onClose}>
      <div className="flex h-full w-[560px] flex-col border-l border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-100 p-4">
          <div>
            <div className="flex items-center gap-2">
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{row.id}</code>
              <StatusChip status={row.status} />
            </div>
            <h3 className="mt-1 text-slate-900" style={{ fontWeight: 500 }}>{row.event}</h3>
            <div className="text-xs text-slate-500">{row.source} · {row.client} · {row.subaccount} · {row.ts}</div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100"><X className="size-4" /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-auto p-4">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <Meta label="Duration" value={row.duration} />
            <Meta label="Result" value={row.result} />
            <Meta label="Retries" value={row.status === "retry" ? "1 of 3" : "0"} />
          </div>
          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Payload</div>
            <JsonViewer data={row.payload} />
          </div>
          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Response</div>
            <JsonViewer data={row.response} />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 p-3">
          <button className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">Copy ID</button>
          <button className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">Replay</button>
          <button className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800">Open in timeline</button>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-slate-800">{value}</div>
    </div>
  );
}
