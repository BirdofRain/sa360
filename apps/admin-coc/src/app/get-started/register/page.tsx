import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AgedVetRegisterForm } from "@/components/public-site/aged-vet-register-form";
import { readTrustedPortalSession } from "@/lib/client-portal/portal-auth";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session";
import { PUBLIC_SETUP_PATH } from "@/lib/public-site/marketing-paths";

export const dynamic = "force-dynamic";

export default async function PublicRegisterPage() {
  const store = await cookies();
  const trusted = await readTrustedPortalSession(
    store.get(CLIENT_PORTAL_SESSION_COOKIE)?.value
  );
  if (trusted) redirect(PUBLIC_SETUP_PATH);
  return <AgedVetRegisterForm />;
}
