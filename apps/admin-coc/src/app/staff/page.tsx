import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { STAFF_SESSION_COOKIE } from "@sa360/shared/staff-google-session";
import { staffGoogleSignInEnabled } from "@sa360/shared/staff-google-oidc";

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

  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center p-6">
      <section className="w-full rounded-lg border border-slate-200 bg-white p-6">
        <h1 className="text-lg font-semibold text-slate-900">Staff sign-in</h1>
        {live.kind === "signed_in" ? (
          <>
            <p className="mt-3 text-sm text-slate-700">Signed in as {live.staffPrincipalId}.</p>
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
              <a href="/staff/google/start" className="mt-4 inline-block text-sm text-slate-900 underline">
                Continue with Google
              </a>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
