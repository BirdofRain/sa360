import { Card, FilterBar, FilterInput, FilterSelect, StatusChip, Toggle } from "../primitives";
import { clients } from "../data";
import { ExternalLink } from "lucide-react";

export function ClientsPage({ onOpenClient }: { onOpenClient: () => void }) {
  return (
    <div className="space-y-4 p-6">
      <FilterBar>
        <FilterInput placeholder="Search org, account ID, location ID…" />
        <FilterSelect label="Status" options={["All", "active", "onboarding", "paused"]} />
        <FilterSelect label="Setup" options={["All", "complete", "in_progress", "blocked"]} />
        <FilterSelect label="Lead type" options={["All", "Final Expense", "Veteran", "Nurse"]} />
        <div className="ml-auto"><button className="rounded-md bg-slate-900 px-2.5 py-1 text-xs text-white hover:bg-slate-800">+ Onboard new client</button></div>
      </FilterBar>

      <Card title={`Clients & subaccounts · ${clients.length}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <Th>Organization</Th><Th>Account ID</Th><Th>GHL Location</Th><Th>Status</Th>
                <Th className="text-center">Voice</Th><Th className="text-center">Blue</Th><Th className="text-center">Green</Th>
                <Th className="text-center">CloseBot</Th><Th className="text-center">GHL AI</Th><Th className="text-center">Meta</Th>
                <Th>Last webhook</Th><Th>Last Synthflow</Th><Th>Setup</Th><Th></Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clients.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td>
                    <div className="text-slate-900" style={{ fontWeight: 500 }}>{c.org}</div>
                    {c.needsAttention && <div className="text-[11px] text-amber-700">⚠ {c.needsAttention}</div>}
                  </Td>
                  <Td><code className="rounded bg-slate-100 px-1 text-[11px]">{c.clientAccountId}</code></Td>
                  <Td><code className="rounded bg-slate-100 px-1 text-[11px]">{c.ghlLocationId}</code></Td>
                  <Td><StatusChip status={c.status} /></Td>
                  <TdToggle on={c.flags.voice} /><TdToggle on={c.flags.blue} /><TdToggle on={c.flags.green} />
                  <TdToggle on={c.flags.closeBot} /><TdToggle on={c.flags.ghlAi} /><TdToggle on={c.flags.metaSync} />
                  <Td className="text-slate-600">{c.lastWebhook}</Td>
                  <Td className="text-slate-600">{c.lastSynth}</Td>
                  <Td><StatusChip status={c.setup} /></Td>
                  <Td><button onClick={onOpenClient} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><ExternalLink className="size-4" /></button></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Th({ children, className = "" }: any) { return <th className={`px-3 py-2 text-left ${className}`}>{children}</th>; }
function Td({ children, className = "" }: any) { return <td className={`px-3 py-2.5 align-middle ${className}`}>{children}</td>; }
function TdToggle({ on }: { on: boolean }) { return <Td className="text-center"><div className="flex justify-center"><Toggle on={on} /></div></Td>; }
