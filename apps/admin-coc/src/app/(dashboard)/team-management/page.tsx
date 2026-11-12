import { TeamManagementPanel } from "@/components/team-management/team-management-panel";
import { AdminCocForbiddenError } from "@/lib/admin-coc-session-guard";
import { loadTeamDirectory, TeamManagementError } from "@/lib/team-management/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team Management" };

export default async function TeamManagementPage() {
  try {
    const directory = await loadTeamDirectory();
    return (
      <TeamManagementPanel
        members={directory.members}
        signInUrl={directory.signInUrl}
        actorStaffPrincipalId={directory.actorStaffPrincipalId}
      />
    );
  } catch (error) {
    if (error instanceof AdminCocForbiddenError) {
      return (
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">Google administrator required</h2>
          <p className="mt-2 text-sm text-slate-700">
            Team Management is available only to a staff member who signed in with Google and holds an active admin_coc grant.
            The shared-password session cannot add or change staff.
          </p>
        </section>
      );
    }
    if (error instanceof TeamManagementError) {
      return (
        <section className="rounded-lg border border-red-200 bg-red-50 p-6">
          <h2 className="text-base font-semibold text-red-900">Team Management is unavailable</h2>
          <p className="mt-2 text-sm text-red-900">{error.message}</p>
        </section>
      );
    }
    throw error;
  }
}
