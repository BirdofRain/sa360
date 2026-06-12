import { DeliveryRuntimeModePanel } from "@/components/delivery-runtime-mode/delivery-runtime-mode-panel";
import { DirectDeliveryDemoPanel } from "@/components/direct-delivery-demo/direct-delivery-demo-panel";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { fetchAdminHealth, isAdminApiConfigured } from "@/lib/admin-api/server";
import { getAdminBuildVersion, type BuildVersionDisplay } from "@/lib/build-version";

function apiBuildFromHealth(
  health: Awaited<ReturnType<typeof fetchAdminHealth>>["data"]
): BuildVersionDisplay | null {
  if (!health?.ok) return null;
  return {
    commitShort: health.commitShort?.trim() || null,
    commitSha: health.commitSha?.trim() || null,
    buildLabel: health.buildLabel?.trim() || null,
  };
}

export default async function DirectDeliveryDemoPage() {
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

  const adminBuild = getAdminBuildVersion();
  const health = await fetchAdminHealth();
  const initialApiBuild = apiBuildFromHealth(health.data);

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
      <DirectDeliveryDemoPanel adminBuild={adminBuild} initialApiBuild={initialApiBuild} />
    </div>
  );
}
