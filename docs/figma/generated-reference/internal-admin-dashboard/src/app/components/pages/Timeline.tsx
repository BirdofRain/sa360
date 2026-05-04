import { Card, FilterSelect, JsonViewer, StatusIcon, TimelineDot } from "../primitives";
import { timeline } from "../data";

export function TimelinePage() {
  return (
    <div className="space-y-4 p-6">
      <Card title="Contact debug · ctc_882 · Marlene · Liberty Final Expense">
        <div className="grid grid-cols-3 gap-4 border-b border-slate-100 px-4 py-3 text-xs">
          <Meta k="Phone" v="+1 305 555 0118" />
          <Meta k="Lead type" v="Final Expense" />
          <Meta k="Source" v="FB · FE_Q2_Marlene" />
          <Meta k="client_account_id" v="cli_001" mono />
          <Meta k="subaccount_id_ghl" v="loc_3xK29fA" mono />
          <Meta k="First seen" v="2026-04-30 14:22:18 UTC" />
        </div>
        <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
          <FilterSelect label="Event type" options={["All", "lead_created", "synthflow_lookup", "meta_dispatch", "review_created"]} />
          <FilterSelect label="Range" options={["Today", "Last 24h", "Last 7d", "All time"]} />
          <span className="ml-auto text-xs text-slate-500">{timeline.length} events</span>
        </div>

        <ol className="relative px-6 py-5">
          <span className="absolute left-[34px] top-5 bottom-5 w-px bg-slate-200" />
          {timeline.map((e) => (
            <li key={e.id} className="relative flex gap-4 pb-5 last:pb-0">
              <div className="relative z-10 flex w-12 shrink-0 justify-center pt-1">
                <TimelineDot status={e.status} />
              </div>
              <div className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={e.status} />
                    <code className="text-[12px] text-slate-800">{e.title}</code>
                  </div>
                  <span className="text-[11px] text-slate-400">{e.ts} UTC</span>
                </div>
                <div className="mt-0.5 text-xs text-slate-600">{e.detail}</div>
                {e.type === "meta_dispatch" && (
                  <div className="mt-2"><JsonViewer data={{ event_name: "Lead", event_id: "evt_8821", error: { code: 190, message: "Invalid access token" } }} /></div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function Meta({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{k}</div>
      <div className={`text-slate-800 ${mono ? "font-mono text-[12px]" : ""}`}>{v}</div>
    </div>
  );
}
