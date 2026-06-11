import { DeliveryRuntimeModePanel } from "@/components/delivery-runtime-mode/delivery-runtime-mode-panel";
import { DirectDeliveryDemoPanel } from "@/components/direct-delivery-demo/direct-delivery-demo-panel";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { isAdminApiConfigured } from "@/lib/admin-api/server";

export default function DirectDeliveryDemoPage() {
  if (!isAdminApiConfigured()) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Direct Delivery Demo</h1>
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY to use direct demo delivery.
        </WarningBanner>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Direct Delivery Demo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Internal guarded path: route → plan → simulate → optional live canary for Smart Agent 360 Demo
          only.
        </p>
      </div>
      <DeliveryRuntimeModePanel />
      <DirectDeliveryDemoPanel />
    </div>
  );
}
