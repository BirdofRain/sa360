import {
  CANONICAL_US_STATE_CODES,
  isCanonicalUsStateCode,
  sanitizeCanonicalUsStates,
  type CanonicalUsStateCode,
} from "@sa360/shared";

import { formatPortalDisplayLabel } from "./portal-labels.ts";

export const PORTAL_ORDER_REQUEST_ACCOUNT_STATUSES = [
  "onboarding",
  "active",
  "paused",
  "archived",
] as const;

export type PortalOrderRequestAccountStatus =
  (typeof PORTAL_ORDER_REQUEST_ACCOUNT_STATUSES)[number];

export type PortalOrderRequestPaymentStatus =
  | "pending_confirmation"
  | "confirmed"
  | "not_required";

export type PortalOrderRequestOption = {
  value: string;
  label: string;
};

export type PortalOrderRequestCatalogs = {
  nicheKeys: PortalOrderRequestOption[];
  productTypes: PortalOrderRequestOption[];
  campaignTypes: PortalOrderRequestOption[];
  crmPackages: PortalOrderRequestOption[];
  deliveryDestinations: PortalOrderRequestOption[];
  states: PortalOrderRequestOption[];
  locationName: string | null;
};

export type PortalOrderRequestDraft = {
  nicheKey: string;
  productType: string;
  states: string[];
  leadVolume: number;
  campaignType: string;
  crmPackage: string;
  deliveryDestinationLabel: string;
  notes: string;
};

export type PortalOrderRequestFieldErrors = Partial<
  Record<
    "nicheKey" | "productType" | "states" | "leadVolume" | "campaignType" | "crmPackage" | "deliveryDestinationLabel" | "notes",
    string
  >
>;

export type PortalOrderCreateSuccessView = {
  id: string;
  orderNumber: string;
  status: string;
  paymentConfirmationStatus: PortalOrderRequestPaymentStatus | null;
};

/** Existing Front Office create values — constrain free-text campaignType. */
export const PORTAL_ORDER_REQUEST_CAMPAIGN_TYPES = [
  { value: "Fresh leads", label: "Fresh leads" },
  { value: "Aged leads", label: "Aged leads" },
  { value: "Live transfer", label: "Live transfer" },
] as const;

/** Existing Front Office create values — constrain free-text crmPackage. */
export const PORTAL_ORDER_REQUEST_CRM_PACKAGES = [
  { value: "GHL Starter", label: "GHL Starter" },
  { value: "GHL Starter + SA360 AI", label: "GHL Starter + SA360 AI" },
  { value: "GHL Pro + SA360 routing", label: "GHL Pro + SA360 routing" },
] as const;

/**
 * Customer-visible niche tokens already used by portal labels.
 * Used only when the account context has no primaryNicheKeys.
 */
export const PORTAL_ORDER_REQUEST_FALLBACK_NICHES = [
  "vet",
  "trucker",
  "nurse",
  "mortgage",
  "solar",
  "insurance",
  "hvac",
  "roofing",
] as const;

export const PORTAL_ORDER_REQUEST_FORBIDDEN_BODY_KEYS = [
  "status",
  "paymentConfirmationStatus",
  "paymentConfirmedAt",
  "paymentConfirmedBy",
  "paymentStatus",
  "clientAccountId",
  "clientDisplayName",
  "orderKind",
  "fulfillmentMode",
  "requestedQuantity",
  "fulfilledQuantity",
  "adminNotes",
  "routingRuleId",
  "campaignId",
  "createdByUserId",
  "createdByRole",
  "unitPriceCents",
  "lineTotalCents",
  "price",
  "prices",
  "amountDue",
] as const;

const US_STATE_LABELS: Record<CanonicalUsStateCode, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
};

export const PORTAL_ORDER_REQUEST_STATE_OPTIONS: PortalOrderRequestOption[] =
  CANONICAL_US_STATE_CODES.map((code) => ({
    value: code,
    label: `${code} · ${US_STATE_LABELS[code]}`,
  }));

const ACCOUNT_STATUS_SET = new Set<string>(PORTAL_ORDER_REQUEST_ACCOUNT_STATUSES);
const PAYMENT_STATUS_SET = new Set<string>([
  "pending_confirmation",
  "confirmed",
  "not_required",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter((item): item is string => Boolean(item));
}

function optionFromValue(value: string): PortalOrderRequestOption {
  return { value, label: formatPortalDisplayLabel(value) || value };
}

export function readPortalOrderRequestAccountStatus(
  raw: unknown
): PortalOrderRequestAccountStatus | null {
  const row = asRecord(raw);
  if (!row) return null;
  const nested = asRecord(row.context) ?? asRecord(row.client) ?? row;
  const status =
    asString(nested.status) ??
    asString(nested.accountStatus) ??
    asString(nested.clientAccountStatus);
  if (!status || !ACCOUNT_STATUS_SET.has(status)) return null;
  return status as PortalOrderRequestAccountStatus;
}

/** READY TO ORDER = ClientAccount.status === active (customer-journey contract). */
export function isPortalAccountEligibleToPlaceOrder(
  status: PortalOrderRequestAccountStatus | string | null | undefined
): boolean {
  return status === "active";
}

export function portalPaymentConfirmationLabel(
  status: string | null | undefined
): string | null {
  switch (status) {
    case "pending_confirmation":
      return "Awaiting payment confirmation";
    case "confirmed":
      return "Payment confirmed";
    case "not_required":
      return "No payment due";
    default:
      return null;
  }
}

export function buildPortalOrderRequestCatalogs(input: {
  primaryNicheKeys?: string[] | null;
  primaryProductTypes?: string[] | null;
  locationName?: string | null;
  displayName?: string | null;
}): PortalOrderRequestCatalogs {
  const nicheKeys = (input.primaryNicheKeys ?? []).map((value) => value.trim()).filter(Boolean);
  const productTypes = (input.primaryProductTypes ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
  const locationName = input.locationName?.trim() || null;
  const displayName = input.displayName?.trim() || null;

  const destinations: PortalOrderRequestOption[] = [];
  if (locationName) {
    destinations.push({ value: locationName, label: locationName });
  }
  if (displayName && displayName !== locationName) {
    destinations.push({ value: displayName, label: displayName });
  }
  if (destinations.length === 0) {
    destinations.push({ value: "Account CRM", label: "Account CRM" });
  }

  return {
    nicheKeys: (nicheKeys.length ? nicheKeys : [...PORTAL_ORDER_REQUEST_FALLBACK_NICHES]).map(
      optionFromValue
    ),
    productTypes: productTypes.map(optionFromValue),
    campaignTypes: PORTAL_ORDER_REQUEST_CAMPAIGN_TYPES.map((option) => ({ ...option })),
    crmPackages: PORTAL_ORDER_REQUEST_CRM_PACKAGES.map((option) => ({ ...option })),
    deliveryDestinations: destinations,
    states: PORTAL_ORDER_REQUEST_STATE_OPTIONS,
    locationName,
  };
}

export function createEmptyPortalOrderRequestDraft(
  catalogs: PortalOrderRequestCatalogs
): PortalOrderRequestDraft {
  return {
    nicheKey: catalogs.nicheKeys[0]?.value ?? "",
    productType: catalogs.productTypes[0]?.value ?? "",
    states: [],
    leadVolume: 100,
    campaignType: catalogs.campaignTypes[0]?.value ?? "Fresh leads",
    crmPackage: catalogs.crmPackages[0]?.value ?? "GHL Starter + SA360 AI",
    deliveryDestinationLabel: catalogs.deliveryDestinations[0]?.value ?? "",
    notes: "",
  };
}

export function validatePortalOrderRequestDraft(
  draft: PortalOrderRequestDraft,
  catalogs: PortalOrderRequestCatalogs
): PortalOrderRequestFieldErrors {
  const errors: PortalOrderRequestFieldErrors = {};
  const allowedNiches = new Set(catalogs.nicheKeys.map((option) => option.value));
  const allowedProducts = new Set(catalogs.productTypes.map((option) => option.value));
  const allowedCampaigns = new Set(catalogs.campaignTypes.map((option) => option.value));
  const allowedCrm = new Set(catalogs.crmPackages.map((option) => option.value));
  const allowedDestinations = new Set(
    catalogs.deliveryDestinations.map((option) => option.value)
  );

  if (!draft.nicheKey.trim() || !allowedNiches.has(draft.nicheKey)) {
    errors.nicheKey = "Choose a lead type.";
  }
  if (catalogs.productTypes.length > 0 && draft.productType && !allowedProducts.has(draft.productType)) {
    errors.productType = "Choose a product from the list.";
  }
  const states = sanitizeCanonicalUsStates(draft.states);
  if (states.length === 0) {
    errors.states = "Choose at least one state.";
  } else if (states.length > 20) {
    errors.states = "Choose up to 20 states.";
  } else if (draft.states.some((state) => !isCanonicalUsStateCode(state))) {
    errors.states = "States must be valid US state codes.";
  }
  if (!Number.isInteger(draft.leadVolume) || draft.leadVolume < 1 || draft.leadVolume > 1_000_000) {
    errors.leadVolume = "Enter a quantity between 1 and 1,000,000.";
  }
  if (!draft.campaignType.trim() || !allowedCampaigns.has(draft.campaignType)) {
    errors.campaignType = "Choose a freshness option.";
  }
  if (!draft.crmPackage.trim() || !allowedCrm.has(draft.crmPackage)) {
    errors.crmPackage = "Choose a CRM destination.";
  }
  if (
    !draft.deliveryDestinationLabel.trim() ||
    !allowedDestinations.has(draft.deliveryDestinationLabel)
  ) {
    errors.deliveryDestinationLabel = "Choose a delivery destination.";
  }
  if (draft.notes.trim().length > 2000) {
    errors.notes = "Notes must be 2,000 characters or fewer.";
  }
  return errors;
}

export function serializePortalOrderCreateBody(
  draft: PortalOrderRequestDraft,
  catalogs: PortalOrderRequestCatalogs
): Record<string, unknown> {
  const errors = validatePortalOrderRequestDraft(draft, catalogs);
  if (Object.keys(errors).length > 0) {
    throw new Error("Order request is not valid");
  }

  const body: Record<string, unknown> = {
    nicheKey: draft.nicheKey.trim(),
    states: sanitizeCanonicalUsStates(draft.states),
    leadVolume: draft.leadVolume,
    campaignType: draft.campaignType.trim(),
    crmPackage: draft.crmPackage.trim(),
    deliveryDestinationLabel: draft.deliveryDestinationLabel.trim(),
  };

  const productType = draft.productType.trim();
  if (productType) body.productType = productType;

  const notes = draft.notes.trim();
  if (notes) body.notes = notes;

  if (catalogs.locationName && draft.deliveryDestinationLabel === catalogs.locationName) {
    body.deliveryDestinationType = "ghl";
  }

  for (const key of PORTAL_ORDER_REQUEST_FORBIDDEN_BODY_KEYS) {
    delete body[key];
  }
  return body;
}

export function portalOrderRequestHasForbiddenFields(
  body: Record<string, unknown>
): boolean {
  return PORTAL_ORDER_REQUEST_FORBIDDEN_BODY_KEYS.some((key) => key in body);
}

/** Keep only the existing client-create contract fields from a browser payload. */
export function sanitizeIncomingPortalOrderCreateBody(
  raw: unknown
): Record<string, unknown> | null {
  const row = asRecord(raw);
  if (!row) return null;
  const nicheKey = asString(row.nicheKey);
  const campaignType = asString(row.campaignType);
  const crmPackage = asString(row.crmPackage);
  const deliveryDestinationLabel = asString(row.deliveryDestinationLabel);
  const leadVolume =
    typeof row.leadVolume === "number"
      ? row.leadVolume
      : typeof row.leadVolume === "string"
        ? Number(row.leadVolume)
        : NaN;
  const states = sanitizeCanonicalUsStates(
    Array.isArray(row.states)
      ? row.states.map((value) => String(value))
      : typeof row.states === "string"
        ? row.states.split(/[,;\s]+/)
        : []
  );
  if (
    !nicheKey ||
    !campaignType ||
    !crmPackage ||
    !deliveryDestinationLabel ||
    !Number.isInteger(leadVolume) ||
    leadVolume < 1 ||
    leadVolume > 1_000_000 ||
    states.length === 0 ||
    states.length > 20
  ) {
    return null;
  }

  const body: Record<string, unknown> = {
    nicheKey,
    states,
    leadVolume,
    campaignType,
    crmPackage,
    deliveryDestinationLabel,
  };
  const productType = asString(row.productType);
  if (productType) body.productType = productType;
  const destinationType = asString(row.deliveryDestinationType);
  if (destinationType) body.deliveryDestinationType = destinationType;
  const notes = asString(row.notes);
  if (notes && notes.length <= 2000) body.notes = notes;
  return body;
}

export function mapPortalOrderCreateSuccess(raw: unknown): PortalOrderCreateSuccessView | null {
  const row = asRecord(raw);
  if (!row) return null;
  const item = asRecord(row.item) ?? row;
  const id = asString(item.id);
  if (!id) return null;
  const paymentRaw = asString(item.paymentConfirmationStatus);
  return {
    id,
    orderNumber: asString(item.orderNumber) ?? id,
    status: asString(item.status) ?? "submitted",
    paymentConfirmationStatus:
      paymentRaw && PAYMENT_STATUS_SET.has(paymentRaw)
        ? (paymentRaw as PortalOrderRequestPaymentStatus)
        : null,
  };
}

export function optionLabel(
  options: PortalOrderRequestOption[],
  value: string
): string {
  return options.find((option) => option.value === value)?.label ?? formatPortalDisplayLabel(value) ?? value;
}

export function formatPortalOrderRequestStates(states: string[]): string {
  return sanitizeCanonicalUsStates(states)
    .map((code) => US_STATE_LABELS[code] ? `${code} · ${US_STATE_LABELS[code]}` : code)
    .join(", ");
}

export function parsePortalOrderCreateError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
  } catch {
    /* keep fallback */
  }
  return "We could not submit your order request. Try again shortly.";
}

export function guardPortalOrderCreateEligibility(rawContext: unknown): {
  ok: false;
  status: 403;
  code: "ACCOUNT_NOT_READY";
  error: string;
} | null {
  const status = readPortalOrderRequestAccountStatus(rawContext);
  if (status && !isPortalAccountEligibleToPlaceOrder(status)) {
    return {
      ok: false,
      status: 403,
      code: "ACCOUNT_NOT_READY",
      error: "Complete your account before placing an order.",
    };
  }
  return null;
}

export function mapPortalOrderRequestContext(raw: unknown, displayName?: string | null) {
  const row = asRecord(raw);
  const context = asRecord(row?.context) ?? row;
  const status = readPortalOrderRequestAccountStatus(raw);
  const catalogs = buildPortalOrderRequestCatalogs({
    primaryNicheKeys: asStringList(context?.primaryNicheKeys),
    primaryProductTypes: asStringList(context?.primaryProductTypes),
    locationName: asString(context?.locationName),
    displayName:
      displayName ??
      asString(context?.portalDisplayName) ??
      asString(context?.clientDisplayName),
  });
  return {
    accountStatus: status,
    eligible: status == null ? true : isPortalAccountEligibleToPlaceOrder(status),
    catalogs,
  };
}
