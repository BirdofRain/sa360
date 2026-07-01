const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization)\s*[:=]\s*\S+/gi,
  /\bsk_[A-Za-z0-9]+\b/g,
  /\bx-sa360-[a-z-]+\s*:\s*\S+/gi,
];

export function redactSecrets(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  let out = value;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  return out.trim() || null;
}

export function maskPhoneForClient(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 4) return `(***) ***-${digits.slice(-4)}`;
  return "(***) ***-****";
}

export function maskPhoneForAdmin(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 10) return `(${digits.slice(0, 3)}) ***-${digits.slice(-4)}`;
  return value.trim();
}

export function maskEmailForClient(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const [local, domain] = value.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}
