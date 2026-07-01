import type { FrontOfficeRole } from "../types";

export function maskPhone(value: string | null | undefined, role: FrontOfficeRole): string {
  if (!value?.trim()) return "—";
  const digits = value.replace(/\D/g, "");
  if (role === "client" || role === "agent") {
    if (digits.length >= 4) return `(***) ***-${digits.slice(-4)}`;
    return "(***) ***-****";
  }
  if (digits.length >= 10) {
    return `(${digits.slice(0, 3)}) ***-${digits.slice(-4)}`;
  }
  return value;
}

export function maskEmail(value: string | null | undefined, role: FrontOfficeRole): string | undefined {
  if (!value?.trim()) return undefined;
  if (role === "admin") return value.trim();
  const [local, domain] = value.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, 1);
  return `${visible}***@${domain}`;
}

export function safeClientLabel(value: string | null | undefined): string {
  if (!value?.trim()) return "Your account";
  return value.trim();
}
