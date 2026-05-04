import { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock, XCircle, Info } from "lucide-react";

// ---------- Status Chip ----------
export function StatusChip({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; dot: string; label: string }> = {
    success: { bg: "bg-emerald-50", fg: "text-emerald-700", dot: "bg-emerald-500", label: "Success" },
    failed: { bg: "bg-red-50", fg: "text-red-700", dot: "bg-red-500", label: "Failed" },
    queued: { bg: "bg-slate-100", fg: "text-slate-700", dot: "bg-slate-400", label: "Queued" },
    retry: { bg: "bg-amber-50", fg: "text-amber-700", dot: "bg-amber-500", label: "Retry" },
    active: { bg: "bg-emerald-50", fg: "text-emerald-700", dot: "bg-emerald-500", label: "Active" },
    onboarding: { bg: "bg-blue-50", fg: "text-blue-700", dot: "bg-blue-500", label: "Onboarding" },
    paused: { bg: "bg-slate-100", fg: "text-slate-600", dot: "bg-slate-400", label: "Paused" },
    open: { bg: "bg-red-50", fg: "text-red-700", dot: "bg-red-500", label: "Open" },
    ack: { bg: "bg-amber-50", fg: "text-amber-700", dot: "bg-amber-500", label: "Acknowledged" },
    resolved: { bg: "bg-emerald-50", fg: "text-emerald-700", dot: "bg-emerald-500", label: "Resolved" },
    complete: { bg: "bg-emerald-50", fg: "text-emerald-700", dot: "bg-emerald-500", label: "Complete" },
    in_progress: { bg: "bg-blue-50", fg: "text-blue-700", dot: "bg-blue-500", label: "In progress" },
    blocked: { bg: "bg-red-50", fg: "text-red-700", dot: "bg-red-500", label: "Blocked" },
  };
  const c = map[status] ?? { bg: "bg-slate-100", fg: "text-slate-700", dot: "bg-slate-400", label: status };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${c.bg} ${c.fg}`}>
      <span className={`size-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

export function ResultChip({ value }: { value: string }) {
  const negative = ["invalid_token", "downstream_timeout", "error", "unknown_caller", "pending_admin"];
  const positive = ["indexed", "known_caller", "appointment_logged", "attribution_upserted"];
  const tone = negative.includes(value) ? "bg-red-50 text-red-700" : positive.includes(value) ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700";
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-xs ${tone}`}>{value}</span>;
}

export function SeverityChip({ severity }: { severity: "critical" | "high" | "medium" | "low" }) {
  const map = {
    critical: "bg-red-100 text-red-800 ring-1 ring-red-200",
    high: "bg-orange-100 text-orange-800 ring-1 ring-orange-200",
    medium: "bg-amber-100 text-amber-800 ring-1 ring-amber-200",
    low: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
  };
  return <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] uppercase tracking-wide ${map[severity]}`}>{severity}</span>;
}

// ---------- Stat Card ----------
export function StatCard({ label, value, delta, tone = "neutral", hint }: { label: string; value: string | number; delta?: string; tone?: "neutral" | "good" | "bad" | "warn"; hint?: string }) {
  const toneColor = { neutral: "text-slate-600", good: "text-emerald-600", bad: "text-red-600", warn: "text-amber-600" }[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline justify-between">
        <div className="text-[26px] tracking-tight text-slate-900" style={{ fontWeight: 500 }}>{value}</div>
        {delta && <span className={`text-xs ${toneColor}`}>{delta}</span>}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

// ---------- Section Card ----------
export function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      {title && (
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-slate-800" style={{ fontWeight: 500 }}>{title}</h3>
          {action}
        </div>
      )}
      <div>{children}</div>
    </div>
  );
}

// ---------- JSON Viewer ----------
export function JsonViewer({ data }: { data: unknown }) {
  return (
    <pre className="max-h-[420px] overflow-auto rounded-lg bg-slate-950 p-3 text-[12px] leading-5 text-slate-100">
      <code>{JSON.stringify(data, null, 2)}</code>
    </pre>
  );
}

// ---------- Toggle ----------
export function Toggle({ on, onChange, disabled }: { on: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange?.(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${on ? "bg-emerald-500" : "bg-slate-300"} ${disabled ? "opacity-50" : ""}`}
    >
      <span className={`inline-block size-4 transform rounded-full bg-white shadow transition ${on ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}

// ---------- Feature toggle row ----------
export function FeatureToggleRow({ name, description, on, onChange }: { name: string; description: string; on: boolean; onChange?: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 last:border-0">
      <div>
        <div className="text-sm text-slate-800" style={{ fontWeight: 500 }}>{name}</div>
        <div className="text-xs text-slate-500">{description}</div>
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}

// ---------- Empty state ----------
export function EmptyState({ icon: Icon = Info, title, hint }: { icon?: any; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="rounded-full bg-slate-50 p-3 text-slate-400"><Icon className="size-5" /></div>
      <div className="text-sm text-slate-700" style={{ fontWeight: 500 }}>{title}</div>
      {hint && <div className="max-w-sm text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

// ---------- Warning banner ----------
export function WarningBanner({ tone = "warn", title, children, action }: { tone?: "warn" | "err" | "info"; title: string; children?: ReactNode; action?: ReactNode }) {
  const t = {
    warn: { bg: "bg-amber-50", border: "border-amber-200", fg: "text-amber-900", icon: AlertTriangle, ic: "text-amber-600" },
    err: { bg: "bg-red-50", border: "border-red-200", fg: "text-red-900", icon: XCircle, ic: "text-red-600" },
    info: { bg: "bg-blue-50", border: "border-blue-200", fg: "text-blue-900", icon: Info, ic: "text-blue-600" },
  }[tone];
  const Ic = t.icon;
  return (
    <div className={`flex items-start gap-3 rounded-lg border ${t.border} ${t.bg} px-4 py-3`}>
      <Ic className={`mt-0.5 size-4 shrink-0 ${t.ic}`} />
      <div className="flex-1">
        <div className={`text-sm ${t.fg}`} style={{ fontWeight: 500 }}>{title}</div>
        {children && <div className={`mt-0.5 text-xs ${t.fg}/80`}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

// ---------- Filter bar ----------
export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2">{children}</div>;
}

export function FilterSelect({ label, options }: { label: string; options: string[] }) {
  return (
    <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600">
      <span className="text-slate-400">{label}</span>
      <select className="bg-transparent text-slate-800 outline-none">
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </label>
  );
}

export function FilterInput({ placeholder }: { placeholder: string }) {
  return <input placeholder={placeholder} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 placeholder:text-slate-400 outline-none focus:border-slate-400" />;
}

// ---------- Timeline item ----------
export function TimelineDot({ status }: { status?: "ok" | "warn" | "err" }) {
  const c = status === "err" ? "bg-red-500" : status === "warn" ? "bg-amber-500" : "bg-emerald-500";
  return <span className={`block size-2.5 rounded-full ring-4 ring-white ${c}`} />;
}

// Icon mapping for statuses
export const StatusIcon = ({ status }: { status?: "ok" | "warn" | "err" }) => {
  if (status === "err") return <XCircle className="size-4 text-red-500" />;
  if (status === "warn") return <AlertTriangle className="size-4 text-amber-500" />;
  return <CheckCircle2 className="size-4 text-emerald-500" />;
};

export { Clock };
