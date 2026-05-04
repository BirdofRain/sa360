import { Activity, AlertOctagon, Building2, Cog, GaugeCircle, History, PhoneCall, Webhook, Layers } from "lucide-react";

export type NavKey =
  | "command"
  | "webhooks"
  | "synthflow"
  | "clients"
  | "client_detail"
  | "review"
  | "timeline"
  | "settings"
  | "library";

const items: { key: NavKey; label: string; icon: any; group?: string; badge?: string }[] = [
  { key: "command", label: "Command Center", icon: GaugeCircle },
  { key: "webhooks", label: "Webhook Monitor", icon: Webhook, badge: "1.2k" },
  { key: "synthflow", label: "Synthflow Voice", icon: PhoneCall },
  { key: "review", label: "Review Queue", icon: AlertOctagon, badge: "7" },
  { key: "timeline", label: "Event Timeline", icon: History },
  { key: "clients", label: "Clients & Subaccounts", icon: Building2 },
  { key: "client_detail", label: "Client Detail", icon: Activity },
  { key: "settings", label: "Settings & Env", icon: Cog },
  { key: "library", label: "Component Library", icon: Layers },
];

export function Sidebar({ active, onNav }: { active: NavKey; onNav: (k: NavKey) => void }) {
  return (
    <aside className="flex w-[248px] shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="grid size-8 place-items-center rounded-lg bg-slate-900 text-white" style={{ fontWeight: 600 }}>S</div>
        <div>
          <div className="text-sm text-slate-900 leading-tight" style={{ fontWeight: 600 }}>Smart Agent 360</div>
          <div className="text-[11px] text-slate-500 leading-tight">Central Operating System</div>
        </div>
      </div>
      <div className="px-3 pb-2">
        <div className="rounded-md bg-slate-50 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Workspace</div>
          <div className="text-xs text-slate-800" style={{ fontWeight: 500 }}>SA360 · Internal Admin</div>
        </div>
      </div>
      <nav className="mt-2 flex-1 px-2">
        <div className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-wider text-slate-400">Operations</div>
        {items.slice(0, 5).map((it) => <NavRow key={it.key} item={it} active={active} onNav={onNav} />)}
        <div className="px-2 pb-1 pt-3 text-[10px] uppercase tracking-wider text-slate-400">Configuration</div>
        {items.slice(5).map((it) => <NavRow key={it.key} item={it} active={active} onNav={onNav} />)}
      </nav>
      <div className="border-t border-slate-100 px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="grid size-7 place-items-center rounded-full bg-slate-200 text-[11px] text-slate-700" style={{ fontWeight: 600 }}>RK</div>
          <div className="leading-tight">
            <div className="text-xs text-slate-800" style={{ fontWeight: 500 }}>Renee Kowalski</div>
            <div className="text-[11px] text-slate-500">Internal Admin · Lvl 3</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function NavRow({ item, active, onNav }: { item: { key: NavKey; label: string; icon: any; badge?: string }; active: NavKey; onNav: (k: NavKey) => void }) {
  const Ic = item.icon;
  const isActive = active === item.key;
  return (
    <button
      onClick={() => onNav(item.key)}
      className={`group mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition ${
        isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
      }`}
    >
      <Ic className={`size-4 ${isActive ? "text-white" : "text-slate-500 group-hover:text-slate-700"}`} />
      <span className="flex-1 text-left">{item.label}</span>
      {item.badge && (
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${isActive ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"}`}>{item.badge}</span>
      )}
    </button>
  );
}
