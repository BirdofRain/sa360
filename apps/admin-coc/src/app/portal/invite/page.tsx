import { getClientPortalDisplayName } from "@/lib/client-portal/config";
import { PORTAL_INVITE_INVALID } from "@/lib/client-portal/portal-invite-flow";

export default function PortalInviteIndexPage() {
  const displayName = getClientPortalDisplayName();
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
