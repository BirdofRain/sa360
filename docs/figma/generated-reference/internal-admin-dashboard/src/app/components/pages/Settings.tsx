import { Card, FeatureToggleRow, StatusChip, WarningBanner } from "../primitives";
import { ShieldCheck, KeyRound, Trash2 } from "lucide-react";

const admins = [
  { name: "Renee Kowalski", email: "renee@sa360.io", role: "Internal Admin · Lvl 3", last: "now" },
  { name: "Devon Marshall", email: "devon@sa360.io", role: "Technical Support", last: "12m ago" },
  { name: "Priya Shah", email: "priya@sa360.io", role: "Beta Onboarding Mgr", last: "3h ago" },
  { name: "Carl Briggs", email: "carl@sa360.io", role: "Agency Manager · External", last: "yesterday" },
];

export function SettingsPage() {
  return (
    <div className="grid grid-cols-3 gap-4 p-6">
      <div className="col-span-2 space-y-4">
        <Card title="Environment">
          <div className="grid grid-cols-3 gap-4 p-4">
            <EnvCard env="production" active />
            <EnvCard env="staging" />
            <EnvCard env="development" />
          </div>
        </Card>

        <Card title="Webhook secrets">
          <div className="space-y-3 p-4 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5">
              <div className="flex items-center gap-3">
                <div className="grid size-8 place-items-center rounded-md bg-emerald-50 text-emerald-600"><ShieldCheck className="size-4" /></div>
                <div>
                  <div className="text-slate-900" style={{ fontWeight: 500 }}>whsec_global · production</div>
                  <div className="text-xs text-slate-500">Rotated 4 days ago · last verified 28s ago</div>
                </div>
              </div>
              <StatusChip status="active" />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5">
              <div className="flex items-center gap-3">
                <div className="grid size-8 place-items-center rounded-md bg-amber-50 text-amber-600"><KeyRound className="size-4" /></div>
                <div>
                  <div className="text-slate-900" style={{ fontWeight: 500 }}>whsec_synthflow · production</div>
                  <div className="text-xs text-slate-500">Rotated 41 days ago — consider rotation</div>
                </div>
              </div>
              <button className="rounded-md bg-slate-900 px-2.5 py-1 text-xs text-white hover:bg-slate-800">Rotate</button>
            </div>
          </div>
        </Card>

        <Card title="System flags">
          <FeatureToggleRow name="Replay enabled" description="Allow internal admin to replay any webhook" on={true} />
          <FeatureToggleRow name="Debug mode" description="Verbose logging + payload retention 30d" on={false} />
          <FeatureToggleRow name="Maintenance banner" description="Show warning banner across all client portals" on={false} />
          <FeatureToggleRow name="Auto-create review items" description="Create review items on Meta CAPI failures" on={true} />
        </Card>

        <WarningBanner tone="info" title="Next planned maintenance: 2026-05-10 06:00 UTC">
          Read-only window expected for ~12 minutes during webhook secret rotation.
        </WarningBanner>
      </div>

      <div className="space-y-4">
        <Card title={`Admin users · ${admins.length}`} action={<button className="text-xs text-slate-700 hover:text-slate-900">+ Invite</button>}>
          <ul className="divide-y divide-slate-100">
            {admins.map((a) => (
              <li key={a.email} className="flex items-center gap-3 px-4 py-3">
                <div className="grid size-8 place-items-center rounded-full bg-slate-200 text-[11px] text-slate-700" style={{ fontWeight: 600 }}>
                  {a.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                </div>
                <div className="flex-1">
                  <div className="text-sm text-slate-900" style={{ fontWeight: 500 }}>{a.name}</div>
                  <div className="text-[11px] text-slate-500">{a.email}</div>
                  <div className="text-[11px] text-slate-400">{a.role} · last active {a.last}</div>
                </div>
                <button className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"><Trash2 className="size-3.5" /></button>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Build">
          <dl className="divide-y divide-slate-100 text-xs">
            {[["Version", "v2026.4.30-r8"], ["Commit", "a91b3c4"], ["Region", "us-east-1"], ["Node", "22.4.1"], ["Uptime", "11d 4h"]].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between px-4 py-2">
                <span className="text-slate-500">{k}</span>
                <span className="font-mono text-[11px] text-slate-800">{v}</span>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}

function EnvCard({ env, active }: { env: "production" | "staging" | "development"; active?: boolean }) {
  const activeBg = env === "production" ? "border-emerald-300 bg-emerald-50" : env === "staging" ? "border-amber-300 bg-amber-50" : "border-slate-300 bg-slate-50";
  return (
    <div className={`rounded-lg border p-3 ${active ? activeBg : "border-slate-200 bg-white"}`}>
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${env === "production" ? "bg-emerald-100 text-emerald-700" : env === "staging" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700"}`}>
          <span className={`size-1.5 rounded-full ${env === "production" ? "bg-emerald-500" : env === "staging" ? "bg-amber-500" : "bg-slate-400"}`} />
          {env}
        </span>
        {active && <span className="text-[10px] uppercase tracking-wide text-slate-500">active</span>}
      </div>
      <div className="mt-2 text-xs text-slate-600">
        <div>hooks.{env === "production" ? "sa360.io" : `${env}.sa360.io`}</div>
        <div className="mt-1 text-slate-400">12 webhooks/sec · p95 184ms</div>
      </div>
    </div>
  );
}
