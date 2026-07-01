import { redactSecrets } from "../lead-delivery/lead-delivery-redact.js";
import type {
  FrontOfficeAudience,
  FrontOfficeTrustCard,
  FrontOfficeTrustResponse,
} from "./front-office.types.js";

const UNSAFE_PATTERNS =
  /(?:Bearer\s|token|secret|password|api[_-]?key|authorization|stack trace|Error:\s|raw payload)/i;

function sanitizeText(text: string, audience: FrontOfficeAudience): string {
  const redacted = redactSecrets(text) ?? text;
  if (audience === "admin") return redacted;
  if (UNSAFE_PATTERNS.test(redacted)) {
    return "Status available — contact your operator for details.";
  }
  return redacted;
}

export function presentTrustCard(
  card: FrontOfficeTrustCard,
  audience: FrontOfficeAudience
): FrontOfficeTrustCard {
  const warnings = card.warnings.map((w) => sanitizeText(w, audience));
  const details = card.details
    .filter((d) => audience === "admin" || !d.adminOnly)
    .map((d) => {
      const out = {
        id: d.id,
        label: audience === "client" ? d.label.replace(/\(admin\)/gi, "").trim() : d.label,
        status: d.status,
        detail: sanitizeText(d.detail, audience),
      };
      if (audience === "admin" && d.adminDetail) {
        return { ...out, adminDetail: sanitizeText(d.adminDetail, audience) };
      }
      return out;
    });

  return {
    key: card.key,
    title: card.title,
    status: card.status,
    source: card.source,
    summary: sanitizeText(card.summary, audience),
    lastCheckedAt: card.lastCheckedAt,
    warnings,
    details,
  };
}

export function presentTrustCenter(
  response: Omit<FrontOfficeTrustResponse, "ok">,
  audience: FrontOfficeAudience
): FrontOfficeTrustResponse {
  return {
    ok: true,
    generatedAt: response.generatedAt,
    dataSource: response.dataSource,
    cards: response.cards.map((c) => presentTrustCard(c, audience)),
  };
}
