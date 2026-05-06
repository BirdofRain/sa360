/**
 * Visual tone for outbound `outcome` strings (Synthflow → SA360 persisted values).
 * Unknown outcomes stay neutral; booked state uses a separate boolean badge on the row.
 */

export type OutboundOutcomeTone = "success" | "info" | "muted" | "danger" | "warn" | "neutral";

export function getOutboundOutcomeTone(outcome: string): OutboundOutcomeTone {
  const o = outcome.trim().toLowerCase();
  if (!o) return "neutral";

  if (o === "already_scheduled_confirmed" || (o.includes("scheduled") && o.includes("confirm"))) {
    return "info";
  }
  if (o === "no_answer" || o === "voicemail" || o.includes("voicemail")) {
    return "muted";
  }
  if (
    o === "failed" ||
    o === "wrong_number" ||
    o === "dnc_requested" ||
    o.includes("dnc") ||
    o.includes("wrong_number")
  ) {
    return "danger";
  }
  if (o === "callback_requested" || o === "reschedule_requested" || o.includes("callback")) {
    return "warn";
  }
  if (o === "booked" || o === "appointment_booked") {
    return "success";
  }

  return "neutral";
}

export function outcomeToneClasses(tone: OutboundOutcomeTone): string {
  switch (tone) {
    case "success":
      return "text-emerald-900 bg-emerald-50 border-emerald-200";
    case "info":
      return "text-sky-900 bg-sky-50 border-sky-200";
    case "muted":
      return "text-slate-600 bg-slate-100 border-slate-200";
    case "danger":
      return "text-red-900 bg-red-50 border-red-200";
    case "warn":
      return "text-amber-950 bg-amber-50 border-amber-200";
    default:
      return "text-slate-800 bg-white border-slate-200";
  }
}

export function bookedBadgeClasses(booked: boolean): string {
  return booked
    ? "text-emerald-900 bg-emerald-50 border-emerald-200"
    : "text-slate-600 bg-slate-50 border-slate-200";
}
