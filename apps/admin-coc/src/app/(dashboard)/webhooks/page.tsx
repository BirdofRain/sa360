import { WebhookMonitorTable } from "@/components/dashboard/webhook-monitor-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function WebhooksPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="grid w-full max-w-xs gap-2">
          <Label htmlFor="filter-client">Client</Label>
          <Input id="filter-client" placeholder="client_account_id" disabled />
        </div>
        <div className="grid w-full max-w-xs gap-2">
          <Label htmlFor="filter-status">Status</Label>
          <Input id="filter-status" placeholder="queued, failed…" disabled />
        </div>
      </div>
      <WebhookMonitorTable />
    </div>
  );
}
