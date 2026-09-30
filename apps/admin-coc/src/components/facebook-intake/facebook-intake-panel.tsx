"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  AssociateFacebookFormResult,
  FacebookFormAssociationItem,
  ReevaluateFacebookCaptureResult,
} from "@/lib/facebook-intake/types";

export function FacebookIntakePanel({
  associations,
  loadError,
  associateAction,
  reevaluateAction,
}: {
  associations: FacebookFormAssociationItem[];
  loadError: string | null;
  associateAction: (input: {
    pageId: string;
    formId: string;
    clientAccountId: string;
    formName?: string;
  }) => Promise<AssociateFacebookFormResult>;
  reevaluateAction: (input: {
    sourceEventId: string;
    operatorNote?: string;
  }) => Promise<ReevaluateFacebookCaptureResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pageId, setPageId] = useState("");
  const [formId, setFormId] = useState("");
  const [clientAccountId, setClientAccountId] = useState("");
  const [formName, setFormName] = useState("");
  const [sourceEventId, setSourceEventId] = useState("");
  const [associateMessage, setAssociateMessage] = useState<string | null>(null);
  const [associateError, setAssociateError] = useState<string | null>(null);
  const [reevaluateMessage, setReevaluateMessage] = useState<string | null>(null);
  const [reevaluateError, setReevaluateError] = useState<string | null>(null);

  function submitAssociation(event: FormEvent) {
    event.preventDefault();
    setAssociateError(null);
    setAssociateMessage(null);
    startTransition(async () => {
      const result = await associateAction({
        pageId,
        formId,
        clientAccountId,
        formName: formName.trim() || undefined,
      });
      if (!result.ok) {
        setAssociateError(result.error);
        return;
      }
      setAssociateMessage(
        result.ownershipUnchanged
          ? `Already associated with ${result.item.clientAccountId}. Historical events were not rewritten.`
          : `Associated page ${result.item.pageId} and form ${result.item.formId} with ${result.item.clientAccountId}. Existing leads were not rewritten.`
      );
      router.refresh();
    });
  }

  function submitReevaluation(event: FormEvent) {
    event.preventDefault();
    setReevaluateError(null);
    setReevaluateMessage(null);
    startTransition(async () => {
      const result = await reevaluateAction({ sourceEventId });
      if (!result.ok) {
        setReevaluateError(result.error);
        return;
      }
      setReevaluateMessage(
        `${result.unchanged ? "Unchanged" : "Updated"} ${result.sourceEventId}: ${result.associationOutcome}. ${result.explanation} Inventory tracked: no. Delivery attempted: no.`
      );
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Facebook Intake</h1>
          <Badge variant="outline">CAPTURE ONLY</Badge>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Zapier can capture Facebook leads before a client association exists. Association means
          this Page ID and Form ID belong to a client. It does not track saleable inventory and it
          does not deliver the lead. GHL location, snapshot, and custom-field setup are not capture
          requirements.
        </p>
      </div>

      <WarningBanner tone="info" title="Four separate outcomes">
        Capture stores the lead. Association links a Page ID and Form ID to an existing client.
        Inventory tracking does not happen on this intake. Delivery is not attempted.
      </WarningBanner>

      {loadError ? (
        <WarningBanner tone="warn" title="Associations unavailable">
          {loadError}
        </WarningBanner>
      ) : null}

      <form onSubmit={submitAssociation} className="space-y-4 rounded-xl border p-4">
        <div>
          <h2 className="font-medium">Associate a Facebook form</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Exact Page ID and Form ID only. The form name is a label and is not used to choose a
            client. Campaign overrides are not part of this step.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="facebook-page-id">Page ID</Label>
            <Input
              id="facebook-page-id"
              value={pageId}
              onChange={(event) => setPageId(event.target.value)}
              inputMode="numeric"
              autoComplete="off"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="facebook-form-id">Form ID</Label>
            <Input
              id="facebook-form-id"
              value={formId}
              onChange={(event) => setFormId(event.target.value)}
              inputMode="numeric"
              autoComplete="off"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="facebook-client-id">Client account ID</Label>
            <Input
              id="facebook-client-id"
              value={clientAccountId}
              onChange={(event) => setClientAccountId(event.target.value)}
              autoComplete="off"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="facebook-form-name">Form name label</Label>
            <Input
              id="facebook-form-name"
              value={formName}
              onChange={(event) => setFormName(event.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
        {associateError ? (
          <WarningBanner tone="err" title="Association was not saved">
            {associateError}
          </WarningBanner>
        ) : null}
        {associateMessage ? (
          <WarningBanner tone="info" title="Association saved">
            {associateMessage}
          </WarningBanner>
        ) : null}
        <Button type="submit" disabled={pending}>
          Save association
        </Button>
      </form>

      <section className="space-y-3">
        <h2 className="font-medium">Confirmed form associations</h2>
        {associations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Facebook form associations yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Page ID</th>
                  <th className="px-3 py-2 font-medium">Form ID</th>
                  <th className="px-3 py-2 font-medium">Client</th>
                  <th className="px-3 py-2 font-medium">Label</th>
                </tr>
              </thead>
              <tbody>
                {associations.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{item.pageId}</td>
                    <td className="px-3 py-2 font-mono text-xs">{item.formId}</td>
                    <td className="px-3 py-2 font-mono text-xs">{item.clientAccountId}</td>
                    <td className="px-3 py-2">{item.formName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <form onSubmit={submitReevaluation} className="space-y-4 rounded-xl border p-4">
        <div>
          <h2 className="font-medium">Reevaluate an existing event</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Uses the stored lead. It does not create another lead, sell inventory, or start
            delivery. A client already stored on the event is not replaced.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="facebook-source-event-id">Source event ID</Label>
          <Input
            id="facebook-source-event-id"
            value={sourceEventId}
            onChange={(event) => setSourceEventId(event.target.value)}
            autoComplete="off"
            required
          />
        </div>
        {reevaluateError ? (
          <WarningBanner tone="err" title="Reevaluation was rejected">
            {reevaluateError}
          </WarningBanner>
        ) : null}
        {reevaluateMessage ? (
          <WarningBanner tone="info" title="Reevaluation result">
            {reevaluateMessage}
          </WarningBanner>
        ) : null}
        <Button type="submit" variant="outline" disabled={pending}>
          Reevaluate association
        </Button>
      </form>
    </div>
  );
}
