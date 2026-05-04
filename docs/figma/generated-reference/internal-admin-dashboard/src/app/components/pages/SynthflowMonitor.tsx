import { Card, FilterBar, FilterInput, FilterSelect, JsonViewer, WarningBanner } from "../primitives";
import { synthflowCalls } from "../data";
import { PhoneIncoming, PhoneOff, Search } from "lucide-react";

export function SynthflowMonitor() {
  const unknown = synthflowCalls.filter((c) => !c.known);
  return (
    <div className="space-y-4 p-6">
      <FilterBar>
        <FilterInput placeholder="From / to / agent / contact ID" />
        <FilterSelect label="Known caller" options={["All", "Yes", "No"]} />
        <FilterSelect label="Matched by" options={["All", "local", "ghl", "not_found", "error"]} />
        <FilterSelect label="Client" options={["All clients", "Liberty Final Expense", "Veteran Benefits Group", "NurseLeads Pro"]} />
        <FilterSelect label="Agent" options={["All agents", "Liberty_Inbound_Agent", "VBG_Inbound_Agent", "NurseLeads_Inbound"]} />
      </FilterBar>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <Card title={`Inbound voice lookups · ${synthflowCalls.length}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <Th>Time</Th><Th>From</Th><Th>To</Th><Th>Known</Th><Th>Matched by</Th><Th>Model</Th><Th>Override</Th><Th>Agent</Th><Th>Variables</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {synthflowCalls.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <Td className="text-slate-500">{c.ts}</Td>
                      <Td><code className="text-[12px]">{c.from}</code></Td>
                      <Td><code className="text-[12px] text-slate-500">{c.to}</code></Td>
                      <Td>
                        {c.known ? (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700"><PhoneIncoming className="size-3" />Known</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700"><PhoneOff className="size-3" />Unknown</span>
                        )}
                      </Td>
                      <Td><MatchedBy value={c.matchedBy} /></Td>
                      <Td><code className="text-[12px]">{c.modelId}</code></Td>
                      <Td>{c.overrideModelId ? <code className="rounded bg-amber-50 px-1 text-[11px] text-amber-700">{c.overrideModelId}</code> : <span className="text-slate-400">—</span>}</Td>
                      <Td className="text-slate-700">{c.agent}</Td>
                      <Td>
                        {Object.keys(c.variables).length === 0 ? <span className="text-slate-400">—</span> : (
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(c.variables).slice(0, 2).map(([k, v]) => (
                              <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700"><span className="text-slate-400">{k}=</span>{v}</span>
                            ))}
                          </div>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {unknown.length > 0 && (
            <WarningBanner tone="warn" title={`${unknown.length} unknown caller${unknown.length === 1 ? "" : "s"} need review`}>
              Diagnostic available for each unknown caller below.
            </WarningBanner>
          )}
          <Card title="Diagnostic · unknown caller">
            <div className="space-y-3 p-4">
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Caller</div>
                <div className="text-sm text-slate-900" style={{ fontWeight: 500 }}>+1 949 555 0022</div>
                <div className="text-xs text-slate-500">to +1 855 555 1020 · Liberty_Inbound_Agent</div>
              </div>
              <DiagStep label="Local DB lookup" status="miss" detail="No contact with phone +19495550022 in client_account_id=cli_001" />
              <DiagStep label="GHL location lookup" status="miss" detail="locationId=loc_3xK29fA · returned 0 results" />
              <DiagStep label="Cross-subaccount fallback" status="skip" detail="disabled by feature flag cross_subaccount_lookup" />
              <DiagStep label="Synthflow response" status="ok" detail="known_caller=false, fallback agent prompt used" />
              <div className="rounded-lg bg-slate-950 p-2">
                <JsonViewer data={{ from: "+19495550022", known_caller: false, matched_by: "not_found", model_id: "gpt-4o-mini", variables: {} }} />
              </div>
              <div className="flex gap-2">
                <button className="flex-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"><Search className="mr-1 inline size-3" />Search GHL</button>
                <button className="flex-1 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white hover:bg-slate-800">Create review item</button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MatchedBy({ value }: { value: "local" | "ghl" | "not_found" | "error" }) {
  const m = {
    local: "bg-emerald-50 text-emerald-700",
    ghl: "bg-blue-50 text-blue-700",
    not_found: "bg-red-50 text-red-700",
    error: "bg-orange-50 text-orange-700",
  }[value];
  return <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] ${m}`}>{value}</span>;
}

function DiagStep({ label, status, detail }: { label: string; status: "ok" | "miss" | "skip"; detail: string }) {
  const c = status === "ok" ? "bg-emerald-500" : status === "miss" ? "bg-red-500" : "bg-slate-300";
  return (
    <div className="flex items-start gap-2.5">
      <span className={`mt-1.5 size-2 rounded-full ${c}`} />
      <div>
        <div className="text-xs text-slate-800" style={{ fontWeight: 500 }}>{label}</div>
        <div className="text-[11px] text-slate-500">{detail}</div>
      </div>
    </div>
  );
}

function Th({ children }: any) { return <th className="px-3 py-2 text-left">{children}</th>; }
function Td({ children, className = "" }: any) { return <td className={`px-3 py-2.5 ${className}`}>{children}</td>; }
