"use client";

import { useEffect, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PORTAL_INVITE_ONBOARD_COPY,
  PORTAL_INVITE_REISSUE_CONFIRM,
  PORTAL_INVITE_RESET_SESSION_COPY,
  PORTAL_PASSWORD_SET_HEADING,
  formatPortalInviteExpiresAt,
  portalInviteBlockedCopy,
  portalInviteEligibility,
  portalPasswordStatusLabel,
  shouldConfirmInviteReissue,
  type IssuePortalInviteResult,
} from "@/lib/clients/portal-invite-operator";
import {
  PORTAL_CANCEL_LOGIN_EMAIL_LABEL,
  PORTAL_CURRENT_LOGIN_EMAIL_LABEL,
  PORTAL_EDIT_LOGIN_EMAIL_LABEL,
  PORTAL_NEW_LOGIN_EMAIL_LABEL,
  PORTAL_UNSAVED_EMAIL_INVITE_COPY,
  canonicalPortalLoginEmail,
  hasUnsavedPortalLoginEmailChange,
} from "@/lib/clients/portal-login-email-edit";
import type { ClientAccountDetail } from "@/lib/clients/types";

function portalLoginUrl(): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/portal/login`;
  }
  const base =
    process.env.NEXT_PUBLIC_CLIENT_PORTAL_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SA360_ADMIN_BASE_URL?.trim();
  return base ? `${base.replace(/\/$/, "")}/portal/login` : "/portal/login";
}

export type ClientPortalAccessIssueAction = (
  clientAccountId: string
) => Promise<IssuePortalInviteResult>;

export function ClientPortalAccessSection({
  client,
  pending,
  onSave,
  issueInviteAction,
}: {
  client: ClientAccountDetail;
  pending: boolean;
  onSave: (e: React.FormEvent<HTMLFormElement>) => void;
  issueInviteAction: ClientPortalAccessIssueAction;
}) {
  const savedLoginEmail = canonicalPortalLoginEmail(client.portalLoginEmail);
  const [editingLoginEmail, setEditingLoginEmail] = useState(false);
  const [draftLoginEmail, setDraftLoginEmail] = useState(savedLoginEmail);
  const [copiedLogin, setCopiedLogin] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [issuedThisSession, setIssuedThisSession] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ inviteUrl: string; expiresAt: string } | null>(
    null
  );
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invitePending, startInvite] = useTransition();
  const loginUrl = portalLoginUrl();
  const portalStatus = client.portalEnabled
    ? client.status === "paused" || client.status === "archived"
      ? "disabled"
      : "active"
    : "disabled";
  const hasPortalPassword = Boolean(client.hasPortalPassword);
  const eligibility = portalInviteEligibility({
    portalEnabled: client.portalEnabled,
    portalLoginEmail: client.portalLoginEmail,
  });
  const unsavedLoginEmail = hasUnsavedPortalLoginEmailChange({
    editing: editingLoginEmail,
    saved: client.portalLoginEmail,
    draft: draftLoginEmail,
  });
  const blockedCopy = unsavedLoginEmail
    ? PORTAL_UNSAVED_EMAIL_INVITE_COPY
    : portalInviteBlockedCopy(eligibility);
  const passwordStatus = portalPasswordStatusLabel(hasPortalPassword);

  useEffect(() => {
    setEditingLoginEmail(false);
    setDraftLoginEmail(canonicalPortalLoginEmail(client.portalLoginEmail));
  }, [client.updatedAt, client.portalLoginEmail]);

  async function copyLoginUrl() {
    try {
      await navigator.clipboard.writeText(loginUrl);
      setCopiedLogin(true);
      setTimeout(() => setCopiedLogin(false), 2000);
    } catch {
      setCopiedLogin(false);
    }
  }

  async function copyInviteUrl() {
    if (!inviteResult) return;
    try {
      await navigator.clipboard.writeText(inviteResult.inviteUrl);
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2000);
    } catch {
      setCopiedInvite(false);
    }
  }

  function startEditLoginEmail() {
    setDraftLoginEmail(savedLoginEmail);
    setEditingLoginEmail(true);
  }

  function cancelEditLoginEmail() {
    setDraftLoginEmail(savedLoginEmail);
    setEditingLoginEmail(false);
  }

  function generateInvite() {
    if (!eligibility.canIssue || unsavedLoginEmail) return;
    if (
      shouldConfirmInviteReissue({
        hasOutstandingPortalInvite: client.hasOutstandingPortalInvite,
        issuedThisSession,
      }) &&
      !window.confirm(PORTAL_INVITE_REISSUE_CONFIRM)
    ) {
      return;
    }
    setInviteError(null);
    startInvite(async () => {
      const result = await issueInviteAction(client.clientAccountId);
      if (!result.ok) {
        setInviteResult(null);
        setInviteError(result.error);
        return;
      }
      setIssuedThisSession(true);
      setInviteResult({ inviteUrl: result.inviteUrl, expiresAt: result.expiresAt });
      setCopiedInvite(false);
    });
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <h3 className="text-sm font-semibold text-slate-900">Portal access</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Maps portal login email to this client account. Metrics on /portal are scoped to this
        clientAccountId.
      </p>
      <div className="mt-3 space-y-4">
        <dl className="grid gap-2 text-sm md:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Portal enabled status</dt>
            <dd className="mt-0.5 flex items-center gap-2">
              <Badge variant={portalStatus === "active" ? "default" : "secondary"}>
                {client.portalEnabled ? "Enabled" : "Disabled"}
              </Badge>
              {portalStatus === "active" ? (
                <span className="text-xs text-muted-foreground">Active</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Portal login email</dt>
            <dd className="mt-0.5 flex flex-wrap items-center gap-2">
              <span className="font-medium" data-testid="portal-login-email-identity">
                {savedLoginEmail || "Not set"}
              </span>
              {!editingLoginEmail ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={startEditLoginEmail}
                >
                  {PORTAL_EDIT_LOGIN_EMAIL_LABEL}
                </Button>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Password status</dt>
            <dd className="mt-0.5 font-medium">{passwordStatus}</dd>
          </div>
        </dl>

        {hasPortalPassword ? (
          <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-sm font-medium text-slate-900">{PORTAL_PASSWORD_SET_HEADING}</p>
            <p className="mt-1 text-xs text-muted-foreground">{PORTAL_INVITE_RESET_SESSION_COPY}</p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{PORTAL_INVITE_ONBOARD_COPY}</p>
        )}

        <form key={client.updatedAt} onSubmit={onSave} className="grid gap-3 md:grid-cols-2">
          <div className="flex items-center gap-2 md:col-span-2">
            <input
              type="checkbox"
              id="portalEnabled"
              name="portalEnabled"
              defaultChecked={client.portalEnabled}
              disabled={pending}
            />
            <Label htmlFor="portalEnabled">Portal enabled</Label>
          </div>
          <div className="grid gap-1.5 md:col-span-2">
            <Label htmlFor="portalDisplayName">Portal display name</Label>
            <Input
              id="portalDisplayName"
              name="portalDisplayName"
              placeholder={client.clientDisplayName}
              defaultValue={client.portalDisplayName ?? ""}
              disabled={pending}
              autoComplete="off"
            />
          </div>
          {editingLoginEmail ? (
            <div className="grid gap-3 rounded-md border border-amber-200 bg-amber-50/70 p-3 md:col-span-2">
              <div>
                <p className="text-xs text-muted-foreground">{PORTAL_CURRENT_LOGIN_EMAIL_LABEL}</p>
                <p className="mt-0.5 text-sm font-medium text-slate-900">
                  {savedLoginEmail || "Not set"}
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="portalLoginEmail">{PORTAL_NEW_LOGIN_EMAIL_LABEL}</Label>
                <Input
                  id="portalLoginEmail"
                  name="portalLoginEmail"
                  type="text"
                  inputMode="email"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-1p-ignore="true"
                  data-lpignore="true"
                  data-bwignore="true"
                  data-form-type="other"
                  value={draftLoginEmail}
                  onChange={(ev) => setDraftLoginEmail(ev.target.value)}
                  disabled={pending}
                />
              </div>
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={cancelEditLoginEmail}
                >
                  {PORTAL_CANCEL_LOGIN_EMAIL_LABEL}
                </Button>
              </div>
            </div>
          ) : null}
          <div className="grid gap-1.5 md:col-span-2">
            <Label>Portal login URL</Label>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-800">{loginUrl}</code>
              <Button type="button" variant="outline" size="sm" onClick={() => void copyLoginUrl()}>
                {copiedLogin ? "Copied" : "Copy portal login URL"}
              </Button>
            </div>
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={pending}>
              Save portal settings
            </Button>
          </div>
        </form>

        <div className="rounded-lg border border-dashed border-slate-200 p-3">
          {eligibility.canIssue ? (
            <div className="space-y-2">
              <Button
                type="button"
                variant={hasPortalPassword ? "outline" : "secondary"}
                disabled={pending || invitePending || unsavedLoginEmail}
                onClick={generateInvite}
              >
                {invitePending
                  ? "Generating…"
                  : hasPortalPassword
                    ? "Generate password reset invite"
                    : "Generate portal invite"}
              </Button>
              {unsavedLoginEmail ? (
                <p className="text-sm text-amber-900" role="status">
                  {PORTAL_UNSAVED_EMAIL_INVITE_COPY}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Invite links expire in 48 hours. Generating a new invite invalidates the previous
                  invite.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-amber-900" role="status">
              {blockedCopy}
            </p>
          )}

          {inviteError ? (
            <p className="mt-2 text-sm text-amber-900" role="alert">
              {inviteError}
            </p>
          ) : null}

          {inviteResult ? (
            <div className="mt-3 space-y-2 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2">
              <p className="text-sm font-semibold text-emerald-900">Portal invite ready</p>
              <p className="text-xs text-emerald-900">
                Expires: {formatPortalInviteExpiresAt(inviteResult.expiresAt)}
              </p>
              <Button type="button" size="sm" onClick={() => void copyInviteUrl()}>
                {copiedInvite ? "Copied" : "Copy invite link"}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
