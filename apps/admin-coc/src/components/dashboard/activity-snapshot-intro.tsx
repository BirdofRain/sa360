import { LEADS_RECEIVED_TODAY_GAP } from "@/lib/command-center/activity-snapshot";

export function ActivitySnapshotIntro() {
  return (
    <div>
      <h2 id="activity-snapshot-heading" className="text-sm font-medium text-slate-800">
        Activity
      </h2>
      <p className="mt-1 text-sm text-slate-600" data-testid="activity-leads-today-gap">
        {LEADS_RECEIVED_TODAY_GAP.summary}
      </p>
      <p className="mt-1 text-xs text-slate-500">Refresh times use America/New_York.</p>
    </div>
  );
}
