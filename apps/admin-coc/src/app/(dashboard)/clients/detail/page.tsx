import { Building2 } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";

export default function ClientDetailPage() {
  return (
    <EmptyState
      icon={Building2}
      title="Client detail"
      hint="Use dynamic routes like /clients/[clientAccountId] when the admin API provides detail payloads."
      className="min-h-[320px] rounded-xl border border-dashed border-slate-200 bg-white"
    />
  );
}
