import type {
  FrontOfficeRole,
  TrustCheckCard,
  TrustCheckDetail,
  TrustCenterResponse,
} from "../types";

const UNSAFE_PATTERNS =
  /(?:Bearer\s|token|secret|password|api[_-]?key|authorization|stack trace|Error:\s|raw payload)/i;

function sanitizeDetailText(text: string, role: FrontOfficeRole): string {
  if (role === "admin") {
    return text.replace(/Bearer\s[^\s]+/gi, "[redacted token]");
  }
  if (UNSAFE_PATTERNS.test(text)) {
    return "Status available — contact your operator for details.";
  }
  return text;
}

function sanitizeCheck(check: TrustCheckDetail, role: FrontOfficeRole): TrustCheckDetail {
  const base: TrustCheckDetail = {
    id: check.id,
    label: check.label,
    status: check.status,
    detail: sanitizeDetailText(check.detail, role),
    source: role === "admin" ? check.source : undefined,
  };
  if (role === "admin" && check.adminDetail) {
    base.adminDetail = sanitizeDetailText(check.adminDetail, role);
  }
  return base;
}

export function sanitizeTrustCard(card: TrustCheckCard, role: FrontOfficeRole): TrustCheckCard {
  if (role === "admin") {
    return {
      ...card,
      checks: card.checks.map((c) => sanitizeCheck(c, role)),
      headline: sanitizeDetailText(card.headline, role),
    };
  }
  return {
    ...card,
    headline: sanitizeDetailText(card.headline, role),
    checks: card.checks
      .filter((c) => !c.adminOnly)
      .map((c) => ({
        ...sanitizeCheck(c, role),
        label: c.label.replace(/\(admin\)/gi, "").trim(),
      })),
  };
}

export function sanitizeTrustCenter(
  response: TrustCenterResponse,
  role: FrontOfficeRole
): TrustCenterResponse {
  return {
    ...response,
    cards: response.cards.map((c) => sanitizeTrustCard(c, role)),
  };
}
