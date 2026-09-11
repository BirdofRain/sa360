"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  customDomainHostsForPageSlug,
  LEADCAPTURE_CUSTOM_DOMAIN_SLUG_MULTIPLE_HOSTS,
  LEADCAPTURE_CUSTOM_DOMAIN_SLUG_USE_FULL_URL,
  LEADCAPTURE_SLUG_PREVIEW_LABEL,
  LEADCAPTURE_SOURCES_CUSTOM_DOMAIN_REQUIRED,
  LEADCAPTURE_SOURCES_CUSTOM_EXAMPLE_URL,
  LEADCAPTURE_SOURCES_HELPER_PRIMARY,
  LEADCAPTURE_SOURCES_STANDARD_EXAMPLE_SLUG,
  LEADCAPTURE_SOURCES_STANDARD_EXAMPLE_URL,
  LEADCAPTURE_URL_PREVIEW_LABEL,
  previewLeadCaptureAssociateInput,
} from "@/lib/clients/leadcapture-page-url";
import {
  associateSuccessMessage,
  CLEAR_ASSOCIATION_CONFIRM_COPY,
  clearSuccessMessage,
  confirmSuccessMessage,
  formatSourceFunnelSeenAt,
  isWaitingForFirstLead,
  LEADCAPTURE_SOURCES_EMPTY_INPUT,
  operatorSafeSourceFunnelError,
  partitionClientSourceFunnels,
  reassignConfirmCopy,
  reassignSuccessMessage,
  sourceFunnelDisplayName,
  sourceFunnelNicheLabel,
  type AssociateSourceFunnelResult,
  type ClearSourceFunnelSuccess,
  type ConfirmSourceFunnelSuccess,
  type ReassignSourceFunnelSuccess,
  type SourceFunnelAdminItem,
  type SourceFunnelOriginConflict,
} from "@/lib/clients/source-funnels";

export type LeadCaptureSourcesListAction = (
  clientAccountId: string
) => Promise<{ ok: true; items: SourceFunnelAdminItem[] } | { ok: false; error: string }>;

export type LeadCaptureSourcesAssociateAction = (
  clientAccountId: string,
  pageUrlOrSlug: string
) => Promise<AssociateSourceFunnelResult>;

export type LeadCaptureSourcesConfirmAction = (
  sourceFunnelId: string,
  originClientAccountId: string
) => Promise<ConfirmSourceFunnelSuccess | SourceFunnelOriginConflict | { ok: false; error: string }>;

export type LeadCaptureSourcesReassignAction = (
  sourceFunnelId: string,
  originClientAccountId: string
) => Promise<ReassignSourceFunnelSuccess | { ok: false; error: string }>;

export type LeadCaptureSourcesClearAction = (
  sourceFunnelId: string
) => Promise<ClearSourceFunnelSuccess | { ok: false; error: string }>;

export type LeadCaptureSourcesSectionProps = {
  clientAccountId: string;
  clientDisplayName: string;
  initialItems: SourceFunnelAdminItem[];
  loadError?: string | null;
  listAction: LeadCaptureSourcesListAction;
  associateAction: LeadCaptureSourcesAssociateAction;
  confirmAction: LeadCaptureSourcesConfirmAction;
  reassignAction: LeadCaptureSourcesReassignAction;
  clearAction: LeadCaptureSourcesClearAction;
};

export function LeadCaptureSourcesSection({
  clientAccountId,
  clientDisplayName,
  initialItems,
  loadError = null,
  listAction,
  associateAction,
  confirmAction,
  reassignAction,
  clearAction,
}: LeadCaptureSourcesSectionProps) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [pageUrlOrSlug, setPageUrlOrSlug] = useState("");
  const [error, setError] = useState<string | null>(loadError);
  const [success, setSuccess] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SourceFunnelOriginConflict | null>(null);
  const [pending, startTransition] = useTransition();

  const { confirmed, suggested } = partitionClientSourceFunnels(items);
  const associatePreview = previewLeadCaptureAssociateInput(pageUrlOrSlug);
  const customDomainSlugHosts =
    associatePreview.kind === "slug"
      ? customDomainHostsForPageSlug(associatePreview.pageSlug, items)
      : [];

  function associate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = pageUrlOrSlug.trim();
    if (!value) {
      setSuccess(null);
      setConflict(null);
      setError(LEADCAPTURE_SOURCES_EMPTY_INPUT);
      return;
    }
    setError(null);
    setSuccess(null);
    setConflict(null);
    startTransition(async () => {
      const result = await associateAction(clientAccountId, value);
      if (!result.ok) {
        if ("code" in result && result.code === "confirm_requires_explicit_reassign") {
          setConflict(result);
          setError(null);
          return;
        }
        setError(operatorSafeSourceFunnelError(result.error));
        return;
      }
      setPageUrlOrSlug("");
      setSuccess(
        associateSuccessMessage({
          created: result.created,
          backfilledInventoryCount: result.backfilledInventoryCount,
          firstSeenAt: result.item.firstSeenAt,
        })
      );
      const listed = await listAction(clientAccountId);
      if (listed.ok) setItems(listed.items);
      router.refresh();
    });
  }

  function confirmSuggested(item: SourceFunnelAdminItem) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await confirmAction(item.id, clientAccountId);
      if (!result.ok) {
        setError(operatorSafeSourceFunnelError(result.error));
        return;
      }
      setSuccess(confirmSuccessMessage(result.backfilledInventoryCount));
      const listed = await listAction(clientAccountId);
      if (listed.ok) setItems(listed.items);
      router.refresh();
    });
  }

  function requestReassign() {
    if (!conflict) return;
    const currentOwner = conflict.currentOriginClientDisplayName?.trim() || "another client";
    if (
      !window.confirm(
        reassignConfirmCopy({
          currentOwner,
          newOwner: clientDisplayName,
        })
      )
    ) {
      return;
    }
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await reassignAction(conflict.sourceFunnelId, clientAccountId);
      if (!result.ok) {
        setError(operatorSafeSourceFunnelError(result.error));
        return;
      }
      setConflict(null);
      setPageUrlOrSlug("");
      setSuccess(reassignSuccessMessage(result));
      const listed = await listAction(clientAccountId);
      if (listed.ok) setItems(listed.items);
      router.refresh();
    });
  }

  function removeAssociation(item: SourceFunnelAdminItem) {
    if (!window.confirm(CLEAR_ASSOCIATION_CONFIRM_COPY)) return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await clearAction(item.id);
      if (!result.ok) {
        setError(operatorSafeSourceFunnelError(result.error));
        return;
      }
      setSuccess(clearSuccessMessage(result.clearedInventoryCount));
      const listed = await listAction(clientAccountId);
      if (listed.ok) setItems(listed.items);
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <h3 className="text-sm font-semibold text-slate-900">LeadCapture Sources</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Associate the LeadCapture pages that generate leads for this client. A client can have
        more than one source page.
      </p>

      <form onSubmit={associate} className="mt-3 grid gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="leadcapture-page-url-or-slug">Page URL or slug</Label>
          <Input
            id="leadcapture-page-url-or-slug"
            name="pageUrlOrSlug"
            value={pageUrlOrSlug}
            onChange={(event) => setPageUrlOrSlug(event.target.value)}
            placeholder="dn_omzoj"
            disabled={pending}
            className="font-mono text-xs"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">{LEADCAPTURE_SOURCES_HELPER_PRIMARY}</p>
          <p className="text-xs text-muted-foreground">{LEADCAPTURE_SOURCES_CUSTOM_DOMAIN_REQUIRED}</p>
          <ul className="text-xs text-muted-foreground">
            <li>
              Standard hosted:{" "}
              <span className="font-mono">
                {LEADCAPTURE_SOURCES_STANDARD_EXAMPLE_SLUG} or {LEADCAPTURE_SOURCES_STANDARD_EXAMPLE_URL}
              </span>
            </li>
            <li>
              Custom domain:{" "}
              <span className="font-mono">{LEADCAPTURE_SOURCES_CUSTOM_EXAMPLE_URL}</span>
            </li>
          </ul>
          {associatePreview.kind === "slug" ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2" role="status">
              <p className="text-xs text-slate-700">{LEADCAPTURE_SLUG_PREVIEW_LABEL}</p>
              <p className="mt-0.5 font-mono text-xs text-slate-900">{associatePreview.parentUrlKey}</p>
            </div>
          ) : null}
          {associatePreview.kind === "url" ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2" role="status">
              <p className="text-xs text-slate-700">{LEADCAPTURE_URL_PREVIEW_LABEL}</p>
              <p className="mt-0.5 font-mono text-xs text-slate-900">{associatePreview.parentUrlKey}</p>
            </div>
          ) : null}
          {customDomainSlugHosts.length === 1 ? (
            <div className="rounded-md border border-amber-300 bg-amber-50/70 px-2.5 py-2" role="status">
              <p className="text-xs text-amber-950">An observed source with this slug already exists on:</p>
              <p className="mt-0.5 font-mono text-xs text-amber-950">{customDomainSlugHosts[0]}</p>
              <p className="mt-1 text-xs text-amber-950">{LEADCAPTURE_CUSTOM_DOMAIN_SLUG_USE_FULL_URL}</p>
            </div>
          ) : null}
          {customDomainSlugHosts.length > 1 ? (
            <div className="rounded-md border border-amber-300 bg-amber-50/70 px-2.5 py-2" role="status">
              <p className="text-xs text-amber-950">{LEADCAPTURE_CUSTOM_DOMAIN_SLUG_MULTIPLE_HOSTS}</p>
              <ul className="mt-1 space-y-0.5">
                {customDomainSlugHosts.map((host) => (
                  <li key={host} className="font-mono text-xs text-amber-950">
                    {host}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Associating…" : "Associate source"}
          </Button>
        </div>
      </form>

      {error ? (
        <p className="mt-3 text-sm text-amber-900" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="mt-3 text-sm text-emerald-800" role="status">
          {success}
        </p>
      ) : null}

      {conflict ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50/60 p-3" role="alert">
          <p className="text-sm font-medium text-amber-950">
            This LeadCapture source is already associated with:
          </p>
          <p className="mt-1 text-sm text-amber-950">
            {conflict.currentOriginClientDisplayName?.trim() || conflict.currentOriginClientAccountId}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setConflict(null)}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={pending} onClick={requestReassign}>
              Reassign to Current Client
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Associated sources ({confirmed.length})
        </h4>
        {confirmed.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No LeadCapture sources associated yet. Associate a page slug or URL above. The form
            stays available so additional pages can be added.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {confirmed.map((item) => (
              <SourceFunnelRow
                key={item.id}
                item={item}
                pending={pending}
                onRemove={() => removeAssociation(item)}
              />
            ))}
          </ul>
        )}
      </div>

      {suggested.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Suggested sources
          </h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Suggestion is not ownership. Confirm only after a human verifies the page belongs to
            this client.
          </p>
          <ul className="mt-2 space-y-2">
            {suggested.map((item) => (
              <SourceFunnelRow
                key={item.id}
                item={item}
                pending={pending}
                suggested
                onConfirm={() => confirmSuggested(item)}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function SourceFunnelRow({
  item,
  pending,
  suggested = false,
  onConfirm,
  onRemove,
}: {
  item: SourceFunnelAdminItem;
  pending: boolean;
  suggested?: boolean;
  onConfirm?: () => void;
  onRemove?: () => void;
}) {
  const niche = sourceFunnelNicheLabel(item.nicheKey);
  const lastSeen = formatSourceFunnelSeenAt(item.lastSeenAt);
  const waiting = isWaitingForFirstLead(item);

  return (
    <li className="rounded-md border border-slate-100 px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">{sourceFunnelDisplayName(item)}</p>
          <p className="font-mono text-xs text-slate-600">{item.pageSlug ?? item.parentUrlKey ?? "—"}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {niche ? <Badge variant="outline">{niche}</Badge> : null}
            <Badge variant={suggested ? "secondary" : "outline"}>
              {suggested ? "Suggested source" : "Confirmed"}
            </Badge>
            {waiting ? (
              <span className="text-xs text-muted-foreground">Waiting for first lead</span>
            ) : lastSeen ? (
              <span className="text-xs text-muted-foreground">Last seen {lastSeen}</span>
            ) : null}
          </div>
          {item.parentUrlKey ? (
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">{item.parentUrlKey}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1">
          {suggested && onConfirm ? (
            <Button type="button" size="sm" disabled={pending} onClick={onConfirm}>
              Confirm association
            </Button>
          ) : null}
          {!suggested && onRemove ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={onRemove}
            >
              Remove association
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
