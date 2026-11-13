import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { STAFF_SESSION_COOKIE } from "@sa360/shared/staff-google-session";
import { staffGoogleSignInEnabled } from "@sa360/shared/staff-google-oidc";
import { STAFF_SIGN_IN_URL } from "@sa360/shared/staff-sign-in-url";

import { readStaffCapabilities } from "@/lib/staff-admin-coc-access";
import { staffCapabilitiesLandingPath } from "@/lib/staff-admin-coc-decision";
import { readLiveStaffSession, staffGoogleConfigReady } from "@/lib/staff-google-browser";

export const dynamic = "force-dynamic";

export default async function StaffHomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!staffGoogleSignInEnabled()) notFound();
  const jar = await cookies();
  const live = await readLiveStaffSession({
    env: process.env,
    sessionCookie: jar.get(STAFF_SESSION_COOKIE)?.value,
  });
  const params = await searchParams;
  const denied = params.error === "denied" || live.kind === "denied";
  const startAvailable = live.kind !== "signed_in" && staffGoogleConfigReady(process.env);
  const capabilities = live.kind === "signed_in" ? await readStaffCapabilities() : null;
  if (capabilities && capabilities.access !== "anonymous" && capabilities.access !== "limited") {
    redirect(staffCapabilitiesLandingPath(capabilities.access));
  }
  const adminDecision = capabilities?.access ?? "anonymous";

  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center p-6">
      <section className="w-full rounded-lg border border-slate-200 bg-white p-6">
        <h1 className="text-lg font-semibold text-slate-900">
          {live.kind === "signed_in" ? "Staff access" : "Staff sign-in"}
        </h1>
        {live.kind === "signed_in" ? (
          <>
            <p className="mt-3 text-sm text-slate-700">Signed in as {live.staffPrincipalId}.</p>
            {adminDecision === "limited" ? (
              <p className="mt-3 text-sm text-slate-700">
                Access denied. This staff account does not have Admin C.O.C. access.
              </p>
            ) : (
              <p className="mt-3 text-sm text-slate-700">Admin access could not be confirmed. Try again.</p>
            )}
            <form action="/staff/google/logout" method="post" className="mt-4">
              <button type="submit" className="rounded bg-slate-900 px-3 py-2 text-sm text-white">
                Log out
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-slate-700">
              {denied ? "Sign-in was denied." : "A provisioned staff identity is required."}
            </p>
            {startAvailable ? (
              <a href={STAFF_SIGN_IN_URL} className="mt-4 inline-block text-sm text-slate-900 underline">
                Continue with Google
              </a>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
