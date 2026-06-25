import Link from "next/link";

import {
  applyGhlMirrorAction,
  previewChannelProfileImpactAction,
  previewGhlMirrorAction,
  saveChannelProfileAction,
  validateChannelProfileReadinessAction,
} from "@/app/actions/channel-profile";
import { ClientChannelProfilePanel } from "@/components/clients/client-channel-profile-panel";
import { ClientGhlProfileMirrorCard } from "@/components/clients/client-ghl-profile-mirror-card";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { fetchAdminClientChannelProfile, isAdminApiConfigured } from "@/lib/admin-api/server";

export default async function ClientSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientAccountId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { clientAccountId } = await params;
  const sp = await searchParams;
  const id = decodeURIComponent(clientAccountId);
  const subRaw = sp.subaccountIdGhl;
  const subaccountIdGhl = typeof subRaw === "string" ? subRaw : undefined;

  const backLink = (
    <Link
      href={`/clients/${encodeURIComponent(id)}`}
      className="text-xs text-sky-700 hover:underline"
    >
      ← Back to client profile
    </Link>
  );

  if (!isAdminApiConfigured()) {
    return (
      <div className="space-y-4">
        {backLink}
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY to load client channel profile
          settings.
        </WarningBanner>
      </div>
    );
  }

  const { data, error } = await fetchAdminClientChannelProfile(id, subaccountIdGhl);

  if (error || !data) {
    const disabled = error?.includes("FEATURE_DISABLED") || error?.includes("disabled");
    return (
      <div className="space-y-4">
        {backLink}
        <h1 className="text-2xl font-semibold tracking-tight">Channel Profile</h1>
        <WarningBanner
          tone={disabled ? "info" : "warn"}
          title={disabled ? "Channel profile settings are disabled" : "Could not load channel profile"}
        >
          {disabled
            ? "Set SA360_CLIENT_PROFILE_SETTINGS_ENABLED=true in the API environment to enable this surface."
            : (error ?? "Unknown error")}
        </WarningBanner>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        {backLink}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Channel Profile</h1>
        <p className="font-mono text-sm text-muted-foreground">
          {data.profile.clientAccountId}
          {data.profile.subaccountIdGhl ? ` · ${data.profile.subaccountIdGhl}` : ""}
        </p>
        {data.defaultsApplied ? (
          <p className="mt-1 text-xs text-muted-foreground">
            No saved profile yet — showing safe defaults. Save to persist.
          </p>
        ) : null}
      </div>

      <ClientChannelProfilePanel
        clientAccountId={data.profile.clientAccountId}
        initialProfile={data.profile}
        initialWriteMode={data.writeMode}
        initialReadiness={data.readiness}
        saveAction={saveChannelProfileAction}
        validateAction={validateChannelProfileReadinessAction}
        impactAction={previewChannelProfileImpactAction}
      />

      <ClientGhlProfileMirrorCard
        clientAccountId={data.profile.clientAccountId}
        subaccountIdGhl={data.profile.subaccountIdGhl}
        mirror={data.mirror}
        writeMode={data.writeMode}
        readiness={data.readiness}
        lastAppliedAt={data.profile.lastAppliedAt}
        previewAction={previewGhlMirrorAction}
        applyAction={applyGhlMirrorAction}
      />
    </div>
  );
}
