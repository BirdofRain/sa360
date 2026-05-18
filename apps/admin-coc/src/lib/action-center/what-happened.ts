import type { ActionCenterActionCode } from "./what-happened-types";

export type WhatHappenedButton = {
  label: string;
  actionCode: ActionCenterActionCode;
  variant?: "default" | "destructive" | "outline";
};

export const WHAT_HAPPENED_BUTTONS: WhatHappenedButton[] = [
  { label: "Call Attempt", actionCode: "CALL_ATTEMPT", variant: "outline" },
  { label: "Connected", actionCode: "CALL_CONNECTED", variant: "outline" },
  { label: "No Answer", actionCode: "NO_ANSWER", variant: "outline" },
  { label: "Booked", actionCode: "BOOKED" },
  { label: "Follow Up", actionCode: "FOLLOW_UP" },
  { label: "Quote Given", actionCode: "QUOTE_GIVEN" },
  { label: "Sold", actionCode: "SOLD" },
  { label: "Not Interested", actionCode: "NOT_INTERESTED", variant: "outline" },
  { label: "Bad Number", actionCode: "BAD_NUMBER", variant: "destructive" },
  { label: "DNC", actionCode: "DNC", variant: "destructive" },
  { label: "Dead Lead", actionCode: "DEAD_LEAD", variant: "destructive" },
];

export const HIGH_IMPACT_ACTION_CODES = new Set<ActionCenterActionCode>([
  "SOLD",
  "DNC",
  "BAD_NUMBER",
  "DEAD_LEAD",
]);

export function actionRequiresForm(actionCode: ActionCenterActionCode): boolean {
  return actionCode === "FOLLOW_UP" || actionCode === "SOLD" || HIGH_IMPACT_ACTION_CODES.has(actionCode);
}

export type SubmitActionCenterActionBody = {
  clientAccountId: string;
  locationId?: string;
  contactIdGhl: string;
  leadUid?: string | null;
  phoneE164?: string | null;
  actionCode: ActionCenterActionCode;
  notes?: string;
  followUpDueAt?: string;
  appointmentStartAt?: string;
  policy?: {
    policyStatus?: string;
    monthlyPremium?: number;
    annualPremium?: number;
    carrier?: string;
    productType?: string;
  };
  actor?: {
    agentName?: string;
    source: "action_center";
  };
};

export type ActionCenterActionResponse = {
  ok: true;
  actionId: string;
  eventsCreated: Array<{ eventUuid: string; eventNameInternal: string }>;
  indexUpdated: boolean;
  ghlWriteback: {
    attempted: boolean;
    status: string;
    message?: string;
  };
};

export async function submitActionCenterAction(
  body: SubmitActionCenterActionBody
): Promise<{ ok: true; data: ActionCenterActionResponse } | { ok: false; error: string }> {
  const res = await fetch("/api/action-dashboard/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      actor: body.actor ?? { source: "action_center" as const },
    }),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, error: text || res.statusText };
  }
  if (!res.ok) {
    const err =
      typeof json === "object" && json !== null && "error" in json
        ? String((json as { error: unknown }).error)
        : text || res.statusText;
    return { ok: false, error: err };
  }
  return { ok: true, data: json as ActionCenterActionResponse };
}
