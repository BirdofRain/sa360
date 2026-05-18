"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Briefcase } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatRelativeTime } from "@/lib/action-center/format";
import type { ActiveLeadWorkspaceItem } from "@/lib/action-center/types";
import {
  HIGH_IMPACT_ACTION_CODES,
  WHAT_HAPPENED_BUTTONS,
  actionRequiresForm,
  submitActionCenterAction,
  type SubmitActionCenterActionBody,
} from "@/lib/action-center/what-happened";
import type { ActionCenterActionCode } from "@/lib/action-center/what-happened-types";
import { cn } from "@/lib/utils";

export type ActionCenterActiveLeadsProps = {
  leads: ActiveLeadWorkspaceItem[];
  clientAccountId: string;
  locationId?: string | null;
  agentDisplayName?: string | null;
};

type PendingAction = {
  lead: ActiveLeadWorkspaceItem;
  actionCode: ActionCenterActionCode;
};

export function ActionCenterActiveLeads({
  leads,
  clientAccountId,
  locationId,
  agentDisplayName,
}: ActionCenterActiveLeadsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [notes, setNotes] = useState("");
  const [followUpDueAt, setFollowUpDueAt] = useState("");
  const [appointmentStartAt, setAppointmentStartAt] = useState("");
  const [policyCarrier, setPolicyCarrier] = useState("");
  const [policyAnnual, setPolicyAnnual] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; message: string } | null>(null);

  const resetForm = useCallback(() => {
    setNotes("");
    setFollowUpDueAt("");
    setAppointmentStartAt("");
    setPolicyCarrier("");
    setPolicyAnnual("");
  }, []);

  const closeSheet = useCallback(() => {
    setPending(null);
    resetForm();
  }, [resetForm]);

  const buildBody = useCallback(
    (lead: ActiveLeadWorkspaceItem, actionCode: ActionCenterActionCode): SubmitActionCenterActionBody => {
      const body: SubmitActionCenterActionBody = {
        clientAccountId,
        locationId: locationId ?? undefined,
        contactIdGhl: lead.contactIdGhl,
        leadUid: lead.leadUid,
        phoneE164: lead.phoneE164 ?? undefined,
        actionCode,
        actor: {
          source: "action_center",
          agentName: agentDisplayName ?? undefined,
        },
      };
      if (notes.trim()) body.notes = notes.trim();
      if (followUpDueAt.trim()) body.followUpDueAt = new Date(followUpDueAt).toISOString();
      if (appointmentStartAt.trim()) {
        body.appointmentStartAt = new Date(appointmentStartAt).toISOString();
      }
      if (actionCode === "SOLD" && (policyCarrier.trim() || policyAnnual.trim())) {
        body.policy = {
          policyStatus: "Issued",
          carrier: policyCarrier.trim() || undefined,
          annualPremium: policyAnnual.trim() ? Number(policyAnnual) : undefined,
        };
      }
      return body;
    },
    [
      agentDisplayName,
      appointmentStartAt,
      clientAccountId,
      followUpDueAt,
      locationId,
      notes,
      policyAnnual,
      policyCarrier,
    ]
  );

  const runSubmit = useCallback(
    async (lead: ActiveLeadWorkspaceItem, actionCode: ActionCenterActionCode) => {
      setSubmitting(true);
      setFlash(null);
      const result = await submitActionCenterAction(buildBody(lead, actionCode));
      setSubmitting(false);
      if (!result.ok) {
        setFlash({ kind: "err", message: result.error });
        return;
      }
      closeSheet();
      setFlash({
        kind: "ok",
        message: `Saved ${actionCode.replace(/_/g, " ").toLowerCase()} (${result.data.eventsCreated.length} events)`,
      });
      router.refresh();
    },
    [buildBody, closeSheet, router]
  );

  const onButtonClick = (lead: ActiveLeadWorkspaceItem, actionCode: ActionCenterActionCode) => {
    resetForm();
    if (actionRequiresForm(actionCode)) {
      setPending({ lead, actionCode });
      return;
    }
    void runSubmit(lead, actionCode);
  };

  const sheetTitle = pending
    ? `${WHAT_HAPPENED_BUTTONS.find((b) => b.actionCode === pending.actionCode)?.label ?? pending.actionCode} — ${pending.lead.displayName}`
    : "";

  const needsFollowUpFields = pending?.actionCode === "FOLLOW_UP";
  const needsSoldFields = pending?.actionCode === "SOLD";
  const needsConfirm = pending ? HIGH_IMPACT_ACTION_CODES.has(pending.actionCode) : false;
  const needsBookedFields = pending?.actionCode === "BOOKED";
  const showNotes =
    needsFollowUpFields || needsConfirm || needsSoldFields || needsBookedFields;

  return (
    <Card className="border-slate-200 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <CardHeader className="border-b border-slate-100 pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-slate-900">
          <Briefcase className="size-4 text-slate-500" aria-hidden />
          Active lead workspace
        </CardTitle>
        <CardDescription>Log outcomes with What Happened? — updates SA360 immediately</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {flash ? (
          <p
            className={cn(
              "mx-4 mt-3 rounded-md border px-3 py-2 text-xs",
              flash.kind === "ok"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-red-200 bg-red-50 text-red-900"
            )}
            role="status"
          >
            {flash.message}
          </p>
        ) : null}
        <ScrollArea className="h-[min(420px,52vh)]">
          <ul className="divide-y divide-slate-100">
            {leads.map((lead) => (
              <li key={lead.contactIdGhl} className="px-4 py-3 hover:bg-slate-50/80">
                <LeadRowHeader lead={lead} />
                <WhatHappenedButtons
                  lead={lead}
                  submitting={submitting}
                  onButtonClick={onButtonClick}
                />
              </li>
            ))}
          </ul>
        </ScrollArea>
      </CardContent>

      <Sheet open={Boolean(pending)} onOpenChange={(open) => !open && closeSheet()}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{sheetTitle}</SheetTitle>
            <SheetDescription>
              {needsConfirm
                ? "Confirm before recording — this updates lifecycle and may exclude the lead from priority."
                : needsFollowUpFields
                  ? "Notes or a follow-up date is required."
                  : "Optional details — submit when ready."}
            </SheetDescription>
          </SheetHeader>
          <ActionFormFields
            showNotes={showNotes}
            needsFollowUpFields={Boolean(needsFollowUpFields)}
            needsBookedFields={Boolean(needsBookedFields)}
            needsSoldFields={Boolean(needsSoldFields)}
            notes={notes}
            setNotes={setNotes}
            followUpDueAt={followUpDueAt}
            setFollowUpDueAt={setFollowUpDueAt}
            appointmentStartAt={appointmentStartAt}
            setAppointmentStartAt={setAppointmentStartAt}
            policyCarrier={policyCarrier}
            setPolicyCarrier={setPolicyCarrier}
            policyAnnual={policyAnnual}
            setPolicyAnnual={setPolicyAnnual}
          />
          <SheetFooter className="gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={closeSheet} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={needsConfirm ? "destructive" : "default"}
              disabled={submitting || !pending}
              onClick={() => pending && void runSubmit(pending.lead, pending.actionCode)}
            >
              {submitting ? "Saving…" : needsConfirm ? "Confirm" : "Submit"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </Card>
  );
}

function LeadRowHeader({ lead }: { lead: ActiveLeadWorkspaceItem }) {
  return (
    <>
      <LeadTitleRow lead={lead} />
      <p className="mt-1 text-sm text-slate-600">{lead.nextAction}</p>
      <LeadMeta lead={lead} />
    </>
  );
}

function LeadTitleRow({ lead }: { lead: ActiveLeadWorkspaceItem }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <p className="font-medium text-slate-900">{lead.displayName}</p>
      <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
        {lead.lifecycleStage}
      </Badge>
    </div>
  );
}

function LeadMeta({ lead }: { lead: ActiveLeadWorkspaceItem }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
      {lead.appointmentStatus ? (
        <span className="rounded bg-slate-100 px-1.5 py-0.5">Appt: {lead.appointmentStatus}</span>
      ) : null}
      {lead.policyStatus ? (
        <span className="rounded bg-slate-100 px-1.5 py-0.5">Policy: {lead.policyStatus}</span>
      ) : null}
      <span>{formatRelativeTime(lead.lastActivityAt)}</span>
      {lead.ownerName ? <span>· {lead.ownerName}</span> : null}
    </div>
  );
}

function WhatHappenedButtons({
  lead,
  submitting,
  onButtonClick,
}: {
  lead: ActiveLeadWorkspaceItem;
  submitting: boolean;
  onButtonClick: (lead: ActiveLeadWorkspaceItem, code: ActionCenterActionCode) => void;
}) {
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
        What happened?
      </p>
      <div className="flex flex-wrap gap-1">
        {WHAT_HAPPENED_BUTTONS.map((btn) => (
          <Button
            key={btn.actionCode}
            type="button"
            size="sm"
            variant={btn.variant ?? "secondary"}
            className="h-7 px-2 text-[11px]"
            disabled={submitting}
            onClick={() => onButtonClick(lead, btn.actionCode)}
          >
            {btn.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ActionFormFields(props: {
  showNotes: boolean;
  needsFollowUpFields: boolean;
  needsBookedFields: boolean;
  needsSoldFields: boolean;
  notes: string;
  setNotes: (v: string) => void;
  followUpDueAt: string;
  setFollowUpDueAt: (v: string) => void;
  appointmentStartAt: string;
  setAppointmentStartAt: (v: string) => void;
  policyCarrier: string;
  setPolicyCarrier: (v: string) => void;
  policyAnnual: string;
  setPolicyAnnual: (v: string) => void;
}) {
  return (
    <div className="grid gap-3 px-4 py-2">
      {props.showNotes ? (
        <div className="grid gap-1.5">
          <Label htmlFor="ac-notes">Notes</Label>
          <textarea
            id="ac-notes"
            className="min-h-[72px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            value={props.notes}
            onChange={(e) => props.setNotes(e.target.value)}
            placeholder={props.needsFollowUpFields ? "Required if no follow-up date" : "Optional"}
          />
        </div>
      ) : null}
      {props.needsFollowUpFields ? (
        <div className="grid gap-1.5">
          <Label htmlFor="ac-follow-up">Follow-up due</Label>
          <Input
            id="ac-follow-up"
            type="datetime-local"
            value={props.followUpDueAt}
            onChange={(e) => props.setFollowUpDueAt(e.target.value)}
          />
        </div>
      ) : null}
      {props.needsBookedFields ? (
        <div className="grid gap-1.5">
          <Label htmlFor="ac-appt">Appointment start (optional)</Label>
          <Input
            id="ac-appt"
            type="datetime-local"
            value={props.appointmentStartAt}
            onChange={(e) => props.setAppointmentStartAt(e.target.value)}
          />
        </div>
      ) : null}
      {props.needsSoldFields ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ac-carrier">Carrier (optional)</Label>
            <Input
              id="ac-carrier"
              value={props.policyCarrier}
              onChange={(e) => props.setPolicyCarrier(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ac-premium">Annual premium (optional)</Label>
            <Input
              id="ac-premium"
              inputMode="decimal"
              value={props.policyAnnual}
              onChange={(e) => props.setPolicyAnnual(e.target.value)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
