import { Card, StatCard, WarningBanner, SeverityChip, StatusChip, Clock } from "../primitives";
import { reviewItems, clients } from "../data";
import { ArrowUpRight, AlertTriangle, Activity } from "lucide-react";

export function CommandCenter() {
  return (
    <div className="space-y-5 p-6">
      <WarningBanner tone="warn" title="Meta CAPI dispatch failing for Liberty Final Expense" action={<button className="rounded-md bg-white px-2.5 py-1 text-xs text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100">Open review</button>}>
        2 events skipped in last 15 minutes — access token returns 190 OAuthException.
      </WarningBanner>

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Webhook requests today" value="12,481" delta="+8.2%" tone="good" hint="vs. yesterday" />
        <StatCard label="GHL events today" value="9,204" delta="+5.1%" tone="good" />
        <StatCard label="Synthflow lookups today" value="612" delta="+12%" tone="good" />
        <StatCard label="Known caller match rate" value="78.4%" delta="-1.3%" tone="warn" hint="last 24h" />
        <StatCard label="Failed requests" value="34" delta="+9 vs avg" tone="bad" />
        <StatCard label="Queue health" value="Healthy" delta="p95 184ms" tone="good" />
        <StatCard label="Open review items" value={reviewItems.filter((r) => r.status === "open").length} delta="2 critical" tone="bad" />
        <StatCard label="Meta sent · skipped · failed" value="412 · 14 · 3" tone="warn" />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <Card title="Latest critical issues" action={<button className="text-xs text-slate-500 hover:text-slate-800">View all</button>}>
            <div className="divide-y divide-slate-100">
              {reviewItems.slice(0, 4).map((r) => (
                <div key={r.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="mt-0.5"><SeverityChip severity={r.severity} /></div>
                  <div className="flex-1">
                    <div className="text-sm text-slate-900">{r.reason}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{r.client} · {r.subaccount} · workflow <code className="rounded bg-slate-100 px-1">{r.workflow}</code></div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusChip status={r.status} />
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400"><Clock className="size-3" />{r.ts}</span>
                    <button className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><ArrowUpRight className="size-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card title="Clients needing attention" action={<span className="text-xs text-slate-400">3 of 24</span>}>
          <ul className="divide-y divide-slate-100">
            {clients.filter((c) => c.needsAttention).map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                <div className="mt-0.5 rounded-md bg-amber-50 p-1.5 text-amber-600"><AlertTriangle className="size-3.5" /></div>
                <div className="flex-1">
                  <div className="text-sm text-slate-900" style={{ fontWeight: 500 }}>{c.org}</div>
                  <div className="text-xs text-slate-500">{c.needsAttention}</div>
                  <div className="mt-1 text-[11px] text-slate-400">{c.clientAccountId} · {c.ghlLocationId}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card title="Webhook throughput (last 60 min)">
          <Sparkline />
        </Card>
        <Card title="Synthflow lookups">
          <Sparkline tone="indigo" />
        </Card>
        <Card title="Meta CAPI dispatch">
          <div className="grid grid-cols-3 gap-2 p-4 text-center">
            <Pill label="Sent" value="412" tone="good" />
            <Pill label="Skipped" value="14" tone="warn" />
            <Pill label="Failed" value="3" tone="bad" />
          </div>
          <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500"><Activity className="mr-1 inline size-3" />Last dispatch 18s ago · evt_8821 (Lead)</div>
        </Card>
      </div>
    </div>
  );
}

function Pill({ label, value, tone }: { label: string; value: string; tone: "good" | "warn" | "bad" }) {
  const t = tone === "good" ? "bg-emerald-50 text-emerald-700" : tone === "warn" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700";
  return (
    <div className={`rounded-lg ${t} px-2 py-3`}>
      <div className="text-[22px]" style={{ fontWeight: 500 }}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide opacity-70">{label}</div>
    </div>
  );
}

function Sparkline({ tone = "emerald" }: { tone?: "emerald" | "indigo" }) {
  const points = [12, 18, 15, 22, 28, 24, 31, 27, 34, 30, 38, 36, 42, 40, 46, 51, 48, 55, 60, 58, 65, 62, 70, 68];
  const max = Math.max(...points);
  const w = 360, h = 96, step = w / (points.length - 1);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${i * step} ${h - (p / max) * (h - 8) - 4}`).join(" ");
  const stroke = tone === "indigo" ? "#6366f1" : "#10b981";
  const fill = tone === "indigo" ? "#eef2ff" : "#ecfdf5";
  return (
    <div className="px-4 py-3">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full">
        <path d={`${path} L ${w} ${h} L 0 ${h} Z`} fill={fill} />
        <path d={path} fill="none" stroke={stroke} strokeWidth={2} />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400"><span>13:30</span><span>14:00</span><span>14:30</span></div>
    </div>
  );
}
