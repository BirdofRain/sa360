import { History } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";

export default function TimelinePage() {
  return (
    <EmptyState
      icon={History}
      title="Event timeline"
      hint="Per-contact debug timeline will load from the admin API."
      className="min-h-[320px] rounded-xl border border-dashed border-slate-200 bg-white"
    />
  );
}
