/**
 * Presentation-only labels for customer-visible portal values.
 * Does not change API contracts or stored enums.
 */

const PORTAL_TOKEN_LABELS: Record<string, string> = {
  // Niches / focus
  vet: "Veteran",
  veteran: "Veteran",
  trucker: "Trucker",
  nurse: "Nurse",
  mortgage: "Mortgage",
  solar: "Solar",
  insurance: "Insurance",
  hvac: "HVAC",
  roofing: "Roofing",

  // Product / inventory / order type
  exclusive: "Exclusive",
  shared: "Shared",
  aged: "Aged",
  live: "Live",
  shared_exclusive: "Shared exclusive",

  // Sources
  meta: "Meta",
  facebook: "Facebook",
  web: "Web",
  form: "Form",
  google: "Google",
  referral: "Referral",
  voice: "Voice",
  call: "Call",
  inbound: "Inbound",
  webhook: "Webhook",
  csv: "CSV",
  spreadsheet: "Spreadsheet",
  google_sheets: "Google Sheets",
  google_sheet_import: "Google Sheet import",
  facebook_lead_form: "Facebook lead form",
  leadcapture: "LeadCapture",
  leadcapture_io: "LeadCapture",
  synthflow: "Synthflow",

  // Destinations / CRM
  ghl: "GHL",
  ghl_pro: "GHL Pro",
  ghl_location: "GHL location",

  // Cadence
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",

  // Appointment / outcome
  appointment_set: "Appointment set",
  appointment_showed: "Appointment showed",
  appointment_confirmed: "Appointment confirmed",
  no_show: "No show",
  set: "Set",
  showed: "Showed",
  sold: "Sold",
  open: "Open",
  canceled: "Canceled",
  cancelled: "Canceled",

  // Lifecycle / events (customer-safe, not marketing copy)
  source_lead_received: "Received",
  lead_created: "Created",
  lead_matched: "Matched",
  lead_routed: "Routed",
  lead_delivery_started: "Delivery started",
  lead_delivered: "Delivered",
  client_contact_created: "Contact created",
  client_workflow_started: "Follow-up started",
  first_touch_sent: "First outreach",
  contact_replied: "Reply received",

  // Delivery / routing leftovers
  in_progress: "In progress",
  not_started: "Not started",
  fulfilled: "Fulfilled",
  needs_setup: "Needs setup",
  needs_compliance: "Needs review",
  review_required: "Needs review",
  not_connected: "Not connected",
  dry_run: "In review",
};

const COMPOUND_SPLIT = /\s*[·•|/]\s*/;

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function titleFirstWord(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function formatUnknownToken(raw: string): string {
  const words = raw
    .trim()
    .split(/[_\s-]+/)
    .filter(Boolean);
  if (words.length === 0) return raw.trim();
  return words
    .map((word, index) => {
      const mapped = PORTAL_TOKEN_LABELS[word.toLowerCase()];
      if (mapped) return mapped;
      return index === 0 ? titleFirstWord(word) : word.toLowerCase();
    })
    .join(" ");
}

function formatSingleToken(raw: string): string {
  const key = normalizeKey(raw);
  if (!key) return "";
  return PORTAL_TOKEN_LABELS[key] ?? formatUnknownToken(raw);
}

/**
 * Format a known domain/enum token or compound source label for customers.
 * Unknown values degrade to readable sentence-style text and never throw.
 */
export function formatPortalDisplayLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "—") return trimmed === "—" ? "—" : "";
  if (/^\d{4}-\d{2}-\d{2}(?:[t\s]|$)/i.test(trimmed)) return trimmed;

  const wholeKey = normalizeKey(trimmed);
  if (PORTAL_TOKEN_LABELS[wholeKey]) return PORTAL_TOKEN_LABELS[wholeKey];

  if (COMPOUND_SPLIT.test(trimmed)) {
    return trimmed
      .split(COMPOUND_SPLIT)
      .map((part) => formatSingleToken(part))
      .filter(Boolean)
      .join(" ");
  }

  return formatSingleToken(trimmed);
}

/** Same as formatPortalDisplayLabel, but empty / em-dash values become null. */
export function formatPortalDisplayValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "—") return null;
  const formatted = formatPortalDisplayLabel(trimmed);
  return formatted || null;
}
