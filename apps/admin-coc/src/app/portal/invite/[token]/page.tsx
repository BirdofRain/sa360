import { PortalInviteForm } from "@/components/client-portal/portal-invite-form";
import { inspectPortalInviteToken } from "@/lib/client-portal-api/portal-context";
import { getClientPortalDisplayName } from "@/lib/client-portal/config";
import {
  isWellFormedPortalInviteToken,
  PORTAL_INVITE_INVALID,
  PORTAL_INVITE_TITLE,
} from "@/lib/client-portal/portal-invite-flow";

export const dynamic = "force-dynamic";

function InviteUnavailable({ displayName }: { displayName: string }) {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-slate-50 to-slate-100/80">
      <div className="mx-auto flex max-w-md flex-col justify-center px-4 py-16 sm:px-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {displayName}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
            Invite unavailable
          </h1>
          <p className="mt-2 text-sm text-slate-600">{PORTAL_INVITE_INVALID}</p>
        </div>
      </div>
    </div>
  );
}

export default async function PortalInviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const displayName = getClientPortalDisplayName();

  if (!isWellFormedPortalInviteToken(token)) {
    return <InviteUnavailable displayName={displayName} />;
  }

  const inspected = await inspectPortalInviteToken(token);
  if (!inspected.ok) {
    return <InviteUnavailable displayName={displayName} />;
  }

  return (
    <div className="min-h-dvh bg-gradient-to-b from-slate-50 to-slate-100/80">
      <div className="mx-auto flex max-w-md flex-col justify-center px-4 py-16 sm:px-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {displayName}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
            {PORTAL_INVITE_TITLE}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Choose a password for your portal. After you save it, sign in with your email
            and this new password.
          </p>
          <PortalInviteForm token={token} />
        </div>
      </div>
    </div>
  );
}
