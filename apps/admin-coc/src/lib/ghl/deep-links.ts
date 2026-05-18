/**
 * GoHighLevel / LeadConnector app deep links for read-only agent navigation.
 *
 * URL paths are centralized here because GHL may change routes between
 * app.gohighlevel.com, white-label hosts, and LeadConnector rebrands.
 *
 * Override origin: `NEXT_PUBLIC_GHL_APP_BASE_URL` (no trailing slash).
 */

/** Path templates — `{locationId}` and `{contactId}` are replaced after encoding. */
export const GHL_DEEP_LINK_PATHS = {
  /** Contact record (detail drawer / page) */
  contact: "/v2/location/{locationId}/contacts/detail/{contactId}",
  /** SMS / chat thread for a contact */
  conversation: "/v2/location/{locationId}/conversations/contacts/{contactId}",
  /** Location calendar — appointments list */
  locationCalendar: "/v2/location/{locationId}/calendars/appointments",
  /** Contact detail with appointments tab (when contact is known) */
  contactAppointments: "/v2/location/{locationId}/contacts/detail/{contactId}?tab=appointments",
} as const;

const DEFAULT_GHL_APP_ORIGIN = "https://app.gohighlevel.com";

const MISSING_CONTACT_ID_HELP =
  "This lead has no GoHighLevel contact ID in SA360 yet. Wait for lifecycle sync or fix the contact mapping.";

const MISSING_LOCATION_HELP =
  "Add locationId to the Action Center URL so SA360 can build GoHighLevel links for this subaccount.";

export type GhlDeepLinkDisabled = {
  disabled: true;
  label: string;
  title: string;
};

export type GhlDeepLinkEnabled = {
  disabled: false;
  href: string;
  label: string;
  title: string;
};

export type GhlDeepLinkAction = GhlDeepLinkDisabled | GhlDeepLinkEnabled;

export type GhlPriorityLeadLinks = {
  openInGhl: GhlDeepLinkAction;
  openConversation: GhlDeepLinkAction;
  openCalendar: GhlDeepLinkAction;
  callNext: GhlDeepLinkAction;
};

export function getGhlAppOrigin(): string {
  const raw =
    process.env.NEXT_PUBLIC_GHL_APP_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_GOHIGHLEVEL_APP_URL?.trim() ||
    DEFAULT_GHL_APP_ORIGIN;
  return raw.replace(/\/+$/, "");
}

function encodeId(id: string): string {
  return encodeURIComponent(id.trim());
}

function fillPath(
  template: string,
  params: { locationId: string; contactId?: string }
): string {
  const loc = encodeId(params.locationId);
  let path = template.replace("{locationId}", loc);
  if (params.contactId !== undefined) {
    path = path.replace("{contactId}", encodeId(params.contactId));
  }
  return path;
}

/** Build an absolute GHL app URL from a path template. */
export function buildGhlAppUrl(
  pathTemplate: string,
  params: { locationId: string; contactId?: string }
): string | null {
  const locationId = params.locationId.trim();
  if (!locationId) return null;
  if (pathTemplate.includes("{contactId}") && !params.contactId?.trim()) {
    return null;
  }
  const origin = getGhlAppOrigin();
  const path = fillPath(pathTemplate, {
    locationId,
    contactId: params.contactId,
  });
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

export function isValidE164Phone(phoneE164: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phoneE164.trim());
}

export function buildSafeTelHref(phoneE164: string): string | null {
  const t = phoneE164.trim();
  if (!isValidE164Phone(t)) return null;
  return `tel:${t}`;
}

export function hasAppointmentLinkSignal(input: {
  appointmentStatus?: string | null;
  dueBy?: string | null;
  reasonCode?: string;
}): boolean {
  if (input.appointmentStatus?.trim()) return true;
  if (input.dueBy?.trim()) return true;
  return input.reasonCode === "ai_appointment_ready";
}

/**
 * Read-only link set for a priority lead row.
 */
export function resolveGhlPriorityLeadLinks(input: {
  locationId?: string | null;
  contactIdGhl?: string | null;
  phoneE164: string;
  appointmentStatus?: string | null;
  dueBy?: string | null;
  reasonCode?: string;
}): GhlPriorityLeadLinks {
  const locationId = input.locationId?.trim() || "";
  const contactId = input.contactIdGhl?.trim() || "";
  const hasLocation = Boolean(locationId);
  const hasContact = Boolean(contactId);

  const openInGhl: GhlDeepLinkAction = (() => {
    if (!hasContact) {
      return {
        disabled: true,
        label: "Missing GHL ID",
        title: MISSING_CONTACT_ID_HELP,
      };
    }
    if (!hasLocation) {
      return {
        disabled: true,
        label: "Open in GHL",
        title: MISSING_LOCATION_HELP,
      };
    }
    const href = buildGhlAppUrl(GHL_DEEP_LINK_PATHS.contact, {
      locationId,
      contactId,
    });
    if (!href) {
      return {
        disabled: true,
        label: "Open in GHL",
        title: "Could not build GoHighLevel contact URL.",
      };
    }
    return {
      disabled: false,
      href,
      label: "Open in GHL",
      title: "Open this contact in GoHighLevel (read-only)",
    };
  })();

  const openConversation: GhlDeepLinkAction = (() => {
    if (!hasContact) {
      return {
        disabled: true,
        label: "Open conversation",
        title: MISSING_CONTACT_ID_HELP,
      };
    }
    if (!hasLocation) {
      return {
        disabled: true,
        label: "Open conversation",
        title: MISSING_LOCATION_HELP,
      };
    }
    const href = buildGhlAppUrl(GHL_DEEP_LINK_PATHS.conversation, {
      locationId,
      contactId,
    });
    if (!href) {
      return {
        disabled: true,
        label: "Open conversation",
        title: "Could not build GoHighLevel conversation URL.",
      };
    }
    return {
      disabled: false,
      href,
      label: "Open conversation",
      title: "Open SMS/chat for this contact in GoHighLevel",
    };
  })();

  const openCalendar: GhlDeepLinkAction = (() => {
    if (!hasAppointmentLinkSignal(input)) {
      return {
        disabled: true,
        label: "Calendar",
        title: "No appointment signal on this lead yet.",
      };
    }
    if (!hasLocation) {
      return {
        disabled: true,
        label: "Calendar",
        title: MISSING_LOCATION_HELP,
      };
    }
    const template = hasContact
      ? GHL_DEEP_LINK_PATHS.contactAppointments
      : GHL_DEEP_LINK_PATHS.locationCalendar;
    const href = buildGhlAppUrl(template, {
      locationId,
      contactId: hasContact ? contactId : undefined,
    });
    if (!href) {
      return {
        disabled: true,
        label: "Calendar",
        title: "Could not build GoHighLevel calendar URL.",
      };
    }
    return {
      disabled: false,
      href,
      label: hasContact ? "Open appointment" : "Open calendar",
      title: hasContact
        ? "Open this contact’s appointments in GoHighLevel"
        : "Open location calendar in GoHighLevel",
    };
  })();

  const callNext: GhlDeepLinkAction = (() => {
    const tel = buildSafeTelHref(input.phoneE164);
    if (!tel) {
      return {
        disabled: true,
        label: "Call next",
        title: "Phone number is missing or not valid E.164 — cannot start a safe tel: link.",
      };
    }
    return {
      disabled: false,
      href: tel,
      label: "Call next",
      title: `Call ${input.phoneE164} (opens your phone or softphone; does not log in SA360 yet)`,
    };
  })();

  return { openInGhl, openConversation, openCalendar, callNext };
}
