import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AgedVetRegisterForm } from "@/components/public-site/aged-vet-register-form";
import { PublicSiteShell } from "@/components/public-site/public-site-shell";
import { readTrustedPortalSession } from "@/lib/client-portal/portal-auth";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session";
import {
  parsePublicLeadPrefillInput,
  publicSetupPathFromPrefill,
} from "@/lib/public-site/lead-request-handoff";

export const dynamic = "force-dynamic";

export default async function PublicRegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const prefill = parsePublicLeadPrefillInput(await searchParams);
  const store = await cookies();
  const trusted = await readTrustedPortalSession(
    store.get(CLIENT_PORTAL_SESSION_COOKIE)?.value
  );
  if (trusted) redirect(publicSetupPathFromPrefill(prefill));
  return (
    <PublicSiteShell>
      <main className="relative mx-auto max-w-lg px-4 py-10 sm:px-6 sm:py-16">
        <AgedVetRegisterForm initialPrefill={prefill} />
      </main>
    </PublicSiteShell>
  );
}
