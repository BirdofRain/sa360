"use client";

export function TeamWorkspaceIntro() {
  return (
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Team Workspace</h1>
      <p className="max-w-2xl text-sm text-slate-600">
        Admin preview for one client. Guided setup can save a client and a setup request. Delivery notification can be turned on or off below. This page does not send email or activate delivery.
      </p>
      <p className="text-sm text-slate-600">Named team access is not turned on. An admin session is required.</p>
    </header>
  );
}

export function TeamWorkspaceMessage({
  title,
  body,
  retryHref,
  onRetry,
}: {
  title: string;
  body: string;
  retryHref?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl space-y-3 rounded-xl border border-slate-200 bg-white p-6">
      <h1 className="text-lg font-semibold text-slate-950">{title}</h1>
      <p className="text-sm text-slate-700">{body}</p>
      {retryHref ? (
        <a href={retryHref} className="inline-flex text-sm font-medium text-sky-800 underline">
          Try again
        </a>
      ) : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} className="inline-flex text-sm font-medium text-sky-800 underline">
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function TeamWorkspaceDisabled() {
  return (
    <div className="space-y-6">
      <TeamWorkspaceIntro />
      <TeamWorkspaceMessage
        title="Team Workspace is turned off"
        body="The page stays hidden until the workspace flag is exactly true. No client data was loaded."
      />
    </div>
  );
}
