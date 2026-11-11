"use client";

import { useState, useTransition } from "react";

import {
  changeTeamAccessAction,
  disableTeamMemberAction,
  inviteTeamMemberAction,
  readTeamMemberAction,
  renewTeamInvitationAction,
  revokeTeamAccessAction,
} from "@/app/actions/team-management";
import type { TeamAccessLevel, TeamActivityEntry, TeamMember } from "@/lib/team-management/types";

const ROLES: Array<{ value: TeamAccessLevel; label: string; detail: string }> = [
  { value: "manager", label: "Manager", detail: "Team Workspace, client setup, and configuration requests." },
  { value: "operations", label: "Operations", detail: "Team Workspace client status. No staff administration." },
  { value: "administrator", label: "Administrator", detail: "Full Command Center and Team Management." },
];

export function TeamManagementPanel({
  members,
  signInUrl,
}: {
  members: TeamMember[];
  signInUrl: string | null;
}) {
  const [rows, setRows] = useState(members);
  const [email, setEmail] = useState("");
  const [accessLevel, setAccessLevel] = useState<TeamAccessLevel>("manager");
  const [confirmAdmin, setConfirmAdmin] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TeamMember | null>(null);
  const [activity, setActivity] = useState<TeamActivityEntry[]>([]);
  const [pending, startTransition] = useTransition();

  function apply(member: TeamMember, message: string) {
    setRows((current) => {
      const next = current.filter((row) => row.staffPrincipalId !== member.staffPrincipalId);
      return [member, ...next];
    });
    setSelected(member);
    setNotice(message);
    setError(null);
  }

  function fail(message: string) {
    setError(message);
    setNotice(null);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
        <h2 className="text-base font-semibold text-slate-900">Add a team member</h2>
        <p className="mt-1 text-sm text-slate-600">
          Use the person&apos;s @lifeagentlaunch.com Google Workspace email. They sign in with Google. There is no invitation code.
        </p>
        <form
          className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await inviteTeamMemberAction({
                email,
                accessLevel,
                confirmAdministrator: accessLevel === "administrator" && confirmAdmin,
              });
              if (!result.ok) {
                fail(result.message);
                return;
              }
              apply(result.member, result.message);
              setEmail("");
              setConfirmAdmin(false);
            });
          }}
        >
          <label className="block text-sm font-medium text-slate-800">
            Email
            <input
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@lifeagentlaunch.com"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Access
            <select
              value={accessLevel}
              onChange={(event) => setAccessLevel(event.target.value as TeamAccessLevel)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {ROLES.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? "Saving…" : "Invite"}
          </button>
        </form>
        <p className="mt-2 text-xs text-slate-500">{ROLES.find((role) => role.value === accessLevel)?.detail}</p>
        {accessLevel === "administrator" ? (
          <label className="mt-3 flex items-start gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={confirmAdmin}
              onChange={(event) => setConfirmAdmin(event.target.checked)}
              className="mt-1"
            />
            I confirm this person should receive full Administrator access. This is recorded with my staff identity.
          </label>
        ) : null}
      </section>

      {notice ? <StatusBanner tone="ok" message={notice} /> : null}
      {error ? <StatusBanner tone="error" message={error} onRetry={() => setError(null)} /> : null}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">Team roster</h2>
          <span className="text-xs text-slate-500">{rows.length} {rows.length === 1 ? "person" : "people"}</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-sm text-slate-600">No staff accounts yet. Add a company email to create a pending invitation.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Person</th>
                  <th className="px-4 py-2 font-medium">Access</th>
                  <th className="px-4 py-2 font-medium">Account</th>
                  <th className="px-4 py-2 font-medium">Invitation</th>
                  <th className="px-4 py-2 font-medium">Last sign-in</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((member) => (
                  <tr
                    key={member.staffPrincipalId}
                    className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                    onClick={() => {
                      setSelected(member);
                      setActivity([]);
                      startTransition(async () => {
                        const result = await readTeamMemberAction({
                          staffPrincipalId: member.staffPrincipalId,
                          email: member.email,
                        });
                        if (!result.ok) {
                          fail(result.message);
                          return;
                        }
                        setSelected(result.detail.member);
                        setActivity(result.detail.activity);
                      });
                    }}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{member.displayName || member.email}</div>
                      <div className="text-xs text-slate-500">{member.email}</div>
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-700">{labelAccess(member.accessLevel)}</td>
                    <td className="px-4 py-3"><StatusPill value={member.accountStatus} /></td>
                    <td className="px-4 py-3 capitalize text-slate-700">{member.invitationStatus}</td>
                    <td className="px-4 py-3 text-slate-600">{member.lastLoginAt ? formatWhen(member.lastLoginAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected ? (
        <MemberDetail
          key={selected.staffPrincipalId}
          member={selected}
          activity={activity}
          pending={pending}
          signInUrl={signInUrl}
          onMessage={apply}
          onError={fail}
        />
      ) : null}
    </div>
  );
}

function MemberDetail({
  member,
  activity,
  pending,
  signInUrl,
  onMessage,
  onError,
}: {
  member: TeamMember;
  activity: TeamActivityEntry[];
  pending: boolean;
  signInUrl: string | null;
  onMessage: (member: TeamMember, message: string) => void;
  onError: (message: string) => void;
}) {
  const [accessLevel, setAccessLevel] = useState<TeamAccessLevel>(member.accessLevel === "none" ? "manager" : member.accessLevel);
  const [confirmAdmin, setConfirmAdmin] = useState(false);
  const [confirmDanger, setConfirmDanger] = useState(false);
  const link = signInUrl ?? "";

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{member.displayName || member.email}</h2>
          <p className="text-sm text-slate-600">{member.email}</p>
        </div>
        <button
          type="button"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          onClick={() => {
            const value = link || `${window.location.origin}/staff/google/start`;
            void navigator.clipboard?.writeText(value).then(
              () => onMessage(member, "Sign-in link copied. It contains no invitation code."),
              () => onError("The link could not be copied. Select it from the field below.")
            );
          }}
        >
          Copy sign-in link
        </button>
      </div>
      <p className="mt-3 break-all rounded-md bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
        {link || "/staff/google/start"}
      </p>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-slate-500">Account</dt><dd className="mt-1"><StatusPill value={member.accountStatus} /></dd></div>
        <div><dt className="text-slate-500">Google enrollment</dt><dd className="mt-1 text-slate-800">{member.bound ? "Connected" : "Waiting for first sign-in"}</dd></div>
        <div><dt className="text-slate-500">Permissions</dt><dd className="mt-1 text-slate-800">{member.permissions.length ? member.permissions.join(", ") : "None"}</dd></div>
        <div><dt className="text-slate-500">Invitation expires</dt><dd className="mt-1 text-slate-800">{member.invitationExpiresAt ? formatWhen(member.invitationExpiresAt) : "—"}</dd></div>
      </dl>

      <div className="mt-5 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="text-sm font-medium text-slate-800">
          Change access
          <select
            value={accessLevel}
            onChange={(event) => setAccessLevel(event.target.value as TeamAccessLevel)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {ROLES.map((role) => (
              <option key={role.value} value={role.value}>{role.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={pending}
          className="self-end rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60"
          onClick={() => {
            if (accessLevel === "administrator" && !confirmAdmin) {
              onError("Confirm Administrator access before saving it.");
              return;
            }
            void changeTeamAccessAction({
              staffPrincipalId: member.staffPrincipalId,
              email: member.email,
              accessLevel,
              confirmAdministrator: accessLevel === "administrator" && confirmAdmin,
            }).then((result) => (result.ok ? onMessage(result.member, result.message) : onError(result.message)));
          }}
        >
          Save access
        </button>
      </div>
      {accessLevel === "administrator" ? (
        <label className="mt-3 flex items-start gap-2 text-sm text-slate-800">
          <input type="checkbox" checked={confirmAdmin} onChange={(event) => setConfirmAdmin(event.target.checked)} className="mt-1" />
          I confirm this grant of Administrator access.
        </label>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        <label className="mr-auto flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={confirmDanger} onChange={(event) => setConfirmDanger(event.target.checked)} />
          Confirm revoke or disable
        </label>
        <button
          type="button"
          disabled={pending || member.bound}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
          onClick={() => {
            void renewTeamInvitationAction({ staffPrincipalId: member.staffPrincipalId, email: member.email }).then((result) =>
              result.ok ? onMessage(result.member, result.message) : onError(result.message)
            );
          }}
        >
          Renew invitation
        </button>
        <button
          type="button"
          disabled={pending || !confirmDanger}
          className="rounded-md border border-amber-300 px-3 py-2 text-sm text-amber-900 disabled:opacity-50"
          onClick={() => {
            void revokeTeamAccessAction({ staffPrincipalId: member.staffPrincipalId, email: member.email }).then((result) =>
              result.ok ? onMessage(result.member, result.message) : onError(result.message)
            );
          }}
        >
          Revoke access
        </button>
        <button
          type="button"
          disabled={pending || !confirmDanger}
          className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-800 disabled:opacity-50"
          onClick={() => {
            void disableTeamMemberAction({ staffPrincipalId: member.staffPrincipalId, email: member.email }).then((result) =>
              result.ok ? onMessage(result.member, result.message) : onError(result.message)
            );
          }}
        >
          Disable account
        </button>
      </div>

      <h3 className="mt-6 text-sm font-semibold text-slate-900">Activity</h3>
      {activity.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">No activity loaded yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 text-sm">
          {activity.map((entry) => (
            <li key={entry.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span className="text-slate-800">{labelActivity(entry.kind, entry.detail)}</span>
              <span className="text-xs text-slate-500">{formatWhen(entry.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusBanner({ tone, message, onRetry }: { tone: "ok" | "error"; message: string; onRetry?: () => void }) {
  return (
    <div className={tone === "ok" ? "rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" : "rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"}>
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="mt-2 underline" onClick={onRetry}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  return <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{labelStatus(value)}</span>;
}

function labelAccess(value: string): string {
  if (value === "administrator") return "Administrator";
  if (value === "manager") return "Manager";
  if (value === "operations") return "Operations";
  return "No access";
}

function labelStatus(value: string): string {
  if (value === "invitation_expired") return "Invitation expired";
  if (value === "invitation_canceled") return "Invitation canceled";
  if (value === "pending") return "Pending";
  if (value === "active") return "Active";
  if (value === "disabled") return "Disabled";
  if (value === "revoked") return "Revoked";
  return value;
}

function labelActivity(kind: string, detail: string | null): string {
  const suffix = detail ? ` (${detail.replaceAll("_", " ")})` : "";
  return `${kind.replaceAll("_", " ")}${suffix}`;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
