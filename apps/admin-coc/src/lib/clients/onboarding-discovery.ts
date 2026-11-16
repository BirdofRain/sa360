import type { SourceFunnelAdminItem } from "./source-funnels";

/**
 * Read-only picture of the sources and destinations already stored for a client.
 * It does not associate a source, save a setup request, share a file, publish a
 * map, or enable delivery. Missing reads stay unknown.
 */

export type DiscoveryTriState = "yes" | "no" | "unknown";

export type DiscoveryCheck = {
  id: string;
  label: string;
  state: DiscoveryTriState;
  statusLabel: string;
  detail: string;
};

export type DiscoveryCampaignIdentifier = {
  label: string;
  value: string;
};

export type DiscoverySource = {
  id: string;
  name: string;
  publicUrl: string | null;
  provider: string;
  /** Set only from an observed source kind. A form vendor is not a traffic platform. */
  trafficPlatform: "Facebook" | "Google" | "Other" | null;
  firstLeadAt: string | null;
  lastLeadAt: string | null;
  associationStatus: SourceFunnelAdminItem["associationStatus"];
  identified: "yes" | "no";
  observed: "yes" | "no";
  associated: "yes" | "no";
  verified: DiscoveryTriState;
  providerFunnelId: string | null;
  /** Routing-rule campaign values matched to this source. Empty means unknown. */
  campaignIdentifiers: DiscoveryCampaignIdentifier[];
  matchedRuleId: string | null;
  /** SA360 event id from source proof. This is not the provider lead UUID. */
  sourceEventId: string | null;
  observedSubmissionAt: string | null;
  /** The current source proof does not carry the provider lead UUID. */
  providerLeadUuid: null;
};

export type DiscoverySpreadsheet = {
  spreadsheetId: string;
  title: string | null;
  url: string;
  supersededAt: string | null;
};

export type OnboardingDiscoveryModel = {
  readOnly: true;
  checks: DiscoveryCheck[];
  sources: DiscoverySource[];
  sourcesAvailability: "ready" | "unavailable";
  clientCampaigns: Array<{
    ruleId: string;
    campaignId: string | null;
    campaignName: string | null;
    utmCampaign: string | null;
    active: boolean;
    deliveryEnabled: boolean;
  }>;
  requestedDestination: {
    availability: "disabled" | "unavailable" | "ready";
    choice: string | null;
    status: string | null;
    revision: number | null;
  };
  sheets: {
    availability: "ready" | "unavailable";
    configured: boolean | null;
    spreadsheetTitle: string | null;
    spreadsheetUrl: string | null;
    spreadsheetId: string | null;
    worksheetTitle: string | null;
    accessStatus: string | null;
    writeReadiness: string | null;
    revision: number | null;
    sharingEmail: string | null;
    sharingPermission: string | null;
    superseded: DiscoverySpreadsheet[];
  };
  google: {
    availability: "ready" | "unavailable";
    email: string | null;
    connectionStatus: string | null;
    rootFolderTitle: string | null;
  };
  clientFolder: {
    availability: "ready" | "unavailable";
    title: string | null;
    url: string | null;
    spreadsheets: Array<{ spreadsheetId: string; title: string; url: string }> | null;
  };
  ghl: {
    configured: boolean;
    locationId: string | null;
    locationName: string | null;
    connectionStatus: string | null;
    deliveryEnabled: boolean;
    fieldMappingComplete: boolean | null;
  };
};

export type OnboardingDiscoveryInput = {
  client: {
    clientDisplayName: string;
    createdAt: string | null;
    ghlDestination: {
      destinationSubaccountIdGhl: string;
      locationName: string | null;
      ghlConnectionStatus: string | null;
      deliveryEnabled: boolean;
      fieldMappingComplete: boolean | null;
    } | null;
    routingRules: Array<{
      id: string;
      campaignId: string | null;
      campaignName: string | null;
      utmCampaign: string | null;
      active: boolean;
      deliveryEnabled: boolean;
    }>;
  };
  sources: {
    availability: "ready" | "unavailable";
    items: SourceFunnelAdminItem[];
  };
  setup: {
    availability: "disabled" | "unavailable" | "ready";
    status: string | null;
    revision: number | null;
    destinationChoice: string | null;
    /**
     * Operator notes on the setup request. Accepted so callers cannot
     * accidentally treat them as evidence: the builder ignores them.
     */
    operatorNotes?: {
      webhookConfigured?: boolean;
      sourceTestSubmitted?: boolean;
      setupReviewed?: boolean;
    };
  };
  sheetsDestination: {
    availability: "ready" | "unavailable";
    destination: {
      spreadsheetId: string;
      spreadsheetTitle: string | null;
      spreadsheetUrl: string;
      worksheetTitle: string;
      accessStatus: string;
      writeReadiness: string;
      revision: number | null;
      sharingEmail: string | null;
      sharingPermission: string | null;
    } | null;
  };
  googleConnection: {
    availability: "ready" | "unavailable";
    email: string | null;
    connectionStatus: string | null;
    rootFolderTitle: string | null;
  };
  clientFolder: {
    availability: "ready" | "unavailable";
    title: string | null;
    url: string | null;
    spreadsheets: Array<{ spreadsheetId: string; title: string; url: string }>;
    links: DiscoverySpreadsheet[];
  };
  sheetsDispatch: {
    availability: "ready" | "unavailable";
    campaignDispatchEnabled: boolean;
    agedDispatchEnabled: boolean;
  };
  sourceProof: {
    availability: "ready" | "unavailable" | "disabled";
    evidenceTruncated: boolean;
    sources: Array<{
      sourceFunnelId: string;
      sourceKind: string;
      observedEventId: string | null;
      observedAt: string | null;
      matchedRuleId: string | null;
      deliverySatisfied: boolean;
    }>;
    fieldMapVerified: boolean | null;
    writerReceiptVerified: boolean | null;
  };
};

const GHL_CONNECTION_NOT_VERIFIED = new Set([
  "error",
  "disconnected",
  "reconnect_required",
  "revoked",
  "expired",
  "token_revoked",
]);

type PermissionLeg = "yes" | "no" | "unknown" | "absent";

export function buildOnboardingDiscovery(input: OnboardingDiscoveryInput): OnboardingDiscoveryModel {
  const rules = input.client.routingRules;
  const sources = input.sources.availability === "ready" ? input.sources.items.map((item) => toSource(item, input)) : [];
  const sheets = sheetsView(input);
  const ghl = ghlView(input);
  const checks = [
    clientRecordCheck(input),
    sourceIdentifiedCheck(input, sources),
    leadObservedCheck(input, sources),
    associationCheck(input, sources),
    destinationCheck(input, sheets.configured, ghl.configured),
    permissionsCheck(input, sheets),
    fieldMappingCheck(input, ghl, sheets.configured),
    testDeliveryCheck(input),
    liveDeliveryCheck(input, ghl.deliveryEnabled),
  ];

  return {
    readOnly: true,
    checks,
    sources,
    sourcesAvailability: input.sources.availability,
    clientCampaigns: rules.map((rule) => ({
      ruleId: rule.id,
      campaignId: blankToNull(rule.campaignId),
      campaignName: blankToNull(rule.campaignName),
      utmCampaign: blankToNull(rule.utmCampaign),
      active: rule.active,
      deliveryEnabled: rule.deliveryEnabled,
    })),
    requestedDestination: {
      availability: input.setup.availability,
      choice: input.setup.availability === "ready" ? blankToNull(input.setup.destinationChoice) : null,
      status: input.setup.availability === "ready" ? input.setup.status : null,
      revision: input.setup.availability === "ready" ? input.setup.revision : null,
    },
    sheets,
    google: {
      availability: input.googleConnection.availability,
      email: input.googleConnection.availability === "ready" ? blankToNull(input.googleConnection.email) : null,
      connectionStatus:
        input.googleConnection.availability === "ready" ? blankToNull(input.googleConnection.connectionStatus) : null,
      rootFolderTitle:
        input.googleConnection.availability === "ready" ? blankToNull(input.googleConnection.rootFolderTitle) : null,
    },
    clientFolder: {
      availability: input.clientFolder.availability,
      title: input.clientFolder.availability === "ready" ? blankToNull(input.clientFolder.title) : null,
      url: input.clientFolder.availability === "ready" ? blankToNull(input.clientFolder.url) : null,
      spreadsheets: input.clientFolder.availability === "ready" ? input.clientFolder.spreadsheets : null,
    },
    ghl,
  };
}

function toSource(item: SourceFunnelAdminItem, input: OnboardingDiscoveryInput): DiscoverySource {
  const proofs =
    input.sourceProof.availability === "ready"
      ? input.sourceProof.sources.filter((proof) => proof.sourceFunnelId === item.id)
      : [];
  const proof = proofs.find((candidate) => candidate.observedEventId) ?? proofs[0] ?? null;
  const rule = proof?.matchedRuleId ? input.client.routingRules.find((candidate) => candidate.id === proof.matchedRuleId) ?? null : null;
  const identified = Boolean(blankToNull(item.parentUrlKey) || blankToNull(item.providerFunnelId) || blankToNull(item.pageSlug));
  return {
    id: item.id,
    name: blankToNull(item.observedFunnelName) ?? "LeadCapture source",
    publicUrl: blankToNull(item.parentUrlKey),
    provider: item.provider,
    trafficPlatform: trafficPlatform(proofs),
    firstLeadAt: blankToNull(item.firstSeenAt),
    lastLeadAt: blankToNull(item.lastSeenAt),
    associationStatus: item.associationStatus,
    identified: identified ? "yes" : "no",
    observed: item.firstSeenAt ? "yes" : "no",
    associated: item.associationStatus === "confirmed" ? "yes" : "no",
    verified: verifiedState(input.sourceProof, proof),
    providerFunnelId: blankToNull(item.providerFunnelId),
    campaignIdentifiers: campaignIdentifiers(rule),
    matchedRuleId: proof?.matchedRuleId ?? null,
    sourceEventId: proof?.observedEventId ?? null,
    observedSubmissionAt: proof?.observedAt ?? null,
    providerLeadUuid: null,
  };
}

function trafficPlatform(proofs: OnboardingDiscoveryInput["sourceProof"]["sources"]): DiscoverySource["trafficPlatform"] {
  const kinds = new Set(proofs.map((proof) => proof.sourceKind));
  if (kinds.size !== 1) return null;
  const kind = [...kinds][0];
  if (kind === "meta_lead_ads" || kind === "zapier_facebook") return "Facebook";
  if (kind === "google" || kind === "google_ads") return "Google";
  if (kind === "other") return "Other";
  return null;
}

function verifiedState(
  proofRead: OnboardingDiscoveryInput["sourceProof"],
  proof: OnboardingDiscoveryInput["sourceProof"]["sources"][number] | null
): DiscoveryTriState {
  if (proofRead.availability !== "ready") return "unknown";
  if (proof?.observedEventId) return "yes";
  if (proofRead.evidenceTruncated && !proof) return "unknown";
  return "no";
}

function campaignIdentifiers(
  rule: OnboardingDiscoveryInput["client"]["routingRules"][number] | null
): DiscoveryCampaignIdentifier[] {
  if (!rule) return [];
  const identifiers: DiscoveryCampaignIdentifier[] = [];
  const campaignId = blankToNull(rule.campaignId);
  const campaignName = blankToNull(rule.campaignName);
  const utmCampaign = blankToNull(rule.utmCampaign);
  if (campaignId) identifiers.push({ label: "Campaign id", value: campaignId });
  if (campaignName) identifiers.push({ label: "Campaign name", value: campaignName });
  if (utmCampaign) identifiers.push({ label: "UTM campaign", value: utmCampaign });
  return identifiers;
}

function sheetsView(input: OnboardingDiscoveryInput): OnboardingDiscoveryModel["sheets"] {
  const destination = input.sheetsDestination.availability === "ready" ? input.sheetsDestination.destination : null;
  const superseded =
    input.clientFolder.availability === "ready"
      ? input.clientFolder.links.filter((link) => link.supersededAt && link.spreadsheetId !== destination?.spreadsheetId)
      : [];
  return {
    availability: input.sheetsDestination.availability,
    configured: input.sheetsDestination.availability === "ready" ? Boolean(destination) : null,
    spreadsheetTitle: destination?.spreadsheetTitle ?? null,
    spreadsheetUrl: destination?.spreadsheetUrl ?? null,
    spreadsheetId: destination?.spreadsheetId ?? null,
    worksheetTitle: destination?.worksheetTitle ?? null,
    accessStatus: destination?.accessStatus ?? null,
    writeReadiness: destination?.writeReadiness ?? null,
    revision: destination?.revision ?? null,
    sharingEmail: destination?.sharingEmail ?? null,
    sharingPermission: destination?.sharingPermission ?? null,
    superseded,
  };
}

function ghlView(input: OnboardingDiscoveryInput): OnboardingDiscoveryModel["ghl"] {
  const destination = input.client.ghlDestination;
  return {
    configured: Boolean(destination),
    locationId: destination ? blankToNull(destination.destinationSubaccountIdGhl) : null,
    locationName: destination ? blankToNull(destination.locationName) : null,
    connectionStatus: destination ? blankToNull(destination.ghlConnectionStatus) : null,
    deliveryEnabled: destination?.deliveryEnabled === true,
    fieldMappingComplete: destination ? destination.fieldMappingComplete : null,
  };
}

function clientRecordCheck(input: OnboardingDiscoveryInput): DiscoveryCheck {
  const created = blankToNull(input.client.createdAt);
  return check(
    "client_record",
    "Client record created",
    "yes",
    "recorded",
    created
      ? `${input.client.clientDisplayName} is already a client record.`
      : `${input.client.clientDisplayName} is already a client record. The created time is unknown.`
  );
}

function sourceIdentifiedCheck(input: OnboardingDiscoveryInput, sources: DiscoverySource[]): DiscoveryCheck {
  if (input.sources.availability !== "ready") {
    return check("source_identified", "Source page identified", "unknown", "recorded", "Source records could not be loaded.");
  }
  const identified = sources.filter((source) => source.identified === "yes");
  if (identified.length === 0) {
    return check("source_identified", "Source page identified", "no", "recorded", "No stored source has a page URL, slug, or provider funnel id.");
  }
  return check(
    "source_identified",
    "Source page identified",
    "yes",
    "recorded",
    `${identified.length} stored source ${identified.length === 1 ? "page is" : "pages are"} identified.`
  );
}

function leadObservedCheck(input: OnboardingDiscoveryInput, sources: DiscoverySource[]): DiscoveryCheck {
  if (input.sources.availability !== "ready") {
    return check("lead_observed", "Real lead observed", "unknown", "recorded", "Source records could not be loaded.");
  }
  const observed = sources.filter((source) => source.observed === "yes");
  if (observed.length === 0) {
    return check("lead_observed", "Real lead observed", "no", "recorded", "No stored source has a first lead time.");
  }
  return check(
    "lead_observed",
    "Real lead observed",
    "yes",
    "recorded",
    `${observed.length} stored source ${observed.length === 1 ? "has" : "have"} a first lead time.`
  );
}

function associationCheck(input: OnboardingDiscoveryInput, sources: DiscoverySource[]): DiscoveryCheck {
  if (input.sources.availability !== "ready") {
    return check(
      "association_confirmed",
      "Source association confirmed",
      "unknown",
      "recorded",
      "Source records could not be loaded."
    );
  }
  const confirmed = sources.filter((source) => source.associated === "yes");
  if (confirmed.length === 0) {
    return check(
      "association_confirmed",
      "Source association confirmed",
      "no",
      "recorded",
      "No source association is confirmed. A suggestion is not ownership."
    );
  }
  return check(
    "association_confirmed",
    "Source association confirmed",
    "yes",
    "recorded",
    `${confirmed.length} source ${confirmed.length === 1 ? "association is" : "associations are"} confirmed.`
  );
}

function destinationCheck(
  input: OnboardingDiscoveryInput,
  sheetsConfigured: boolean | null,
  ghlConfigured: boolean
): DiscoveryCheck {
  if (ghlConfigured || sheetsConfigured === true) {
    const parts = [
      ghlConfigured ? "GoHighLevel destination is stored" : null,
      sheetsConfigured ? "Company Sheets destination is stored" : null,
    ].filter((part): part is string => Boolean(part));
    return check("destination_configured", "Destination configured", "yes", "recorded", `${parts.join(". ")}.`);
  }
  if (sheetsConfigured === null) {
    return check(
      "destination_configured",
      "Destination configured",
      "unknown",
      "recorded",
      "The Company Sheets destination could not be loaded. A requested destination is not counted."
    );
  }
  const requested = input.setup.availability === "ready" ? blankToNull(input.setup.destinationChoice) : null;
  return check(
    "destination_configured",
    "Destination configured",
    "no",
    "recorded",
    requested
      ? `No operational destination is stored. The setup request asks for ${requested.replaceAll("_", " ")} and is not a destination.`
      : "No operational destination is stored."
  );
}

function permissionsCheck(input: OnboardingDiscoveryInput, sheets: OnboardingDiscoveryModel["sheets"]): DiscoveryCheck {
  const google = googlePermission(input, sheets);
  const ghl = ghlPermission(input);
  const active = [google, ghl].filter((leg) => leg !== "absent");
  if (active.length === 0) {
    return check(
      "permissions_verified",
      "Google/GHL permissions verified",
      "no",
      "verified",
      "No operational Google or GoHighLevel destination is stored, so permissions were not verified."
    );
  }
  if (active.includes("no")) {
    return check("permissions_verified", "Google/GHL permissions verified", "no", "verified", permissionDetail(google, ghl));
  }
  if (active.includes("unknown")) {
    return check("permissions_verified", "Google/GHL permissions verified", "unknown", "verified", permissionDetail(google, ghl));
  }
  return check("permissions_verified", "Google/GHL permissions verified", "yes", "verified", permissionDetail(google, ghl));
}

function googlePermission(input: OnboardingDiscoveryInput, sheets: OnboardingDiscoveryModel["sheets"]): PermissionLeg {
  if (input.sheetsDestination.availability !== "ready") return "unknown";
  if (!sheets.configured) return "absent";
  if (sheets.writeReadiness === "verified") return "yes";
  return "no";
}

function ghlPermission(input: OnboardingDiscoveryInput): PermissionLeg {
  const destination = input.client.ghlDestination;
  if (!destination) return "absent";
  const status = blankToNull(destination.ghlConnectionStatus)?.toLowerCase() ?? null;
  if (status && GHL_CONNECTION_NOT_VERIFIED.has(status)) return "no";
  return "unknown";
}

function permissionDetail(google: PermissionLeg, ghl: PermissionLeg): string {
  return `Google write access: ${permissionPhrase(google)}. GoHighLevel permission probe: ${permissionPhrase(ghl)}. A connection status of connected is not a permission verification.`;
}

function permissionPhrase(leg: PermissionLeg): string {
  if (leg === "yes") return "verified";
  if (leg === "no") return "not verified";
  if (leg === "absent") return "no destination stored";
  return "unknown";
}

function fieldMappingCheck(
  input: OnboardingDiscoveryInput,
  ghl: OnboardingDiscoveryModel["ghl"],
  sheetsConfigured: boolean | null
): DiscoveryCheck {
  const published = input.sourceProof.availability === "ready" ? input.sourceProof.fieldMapVerified : null;
  if (published === true) {
    return check(
      "field_mapping_verified",
      "Field mapping verified",
      "yes",
      "verified",
      "The onboarding read reports a published column map or a bound header that matches it."
    );
  }
  if (published === false && sheetsConfigured === true) {
    return check(
      "field_mapping_verified",
      "Field mapping verified",
      "no",
      "verified",
      "A Company Sheets destination is stored and the onboarding read does not report a verified published column map."
    );
  }
  if (published === null && sheetsConfigured === true) {
    return check(
      "field_mapping_verified",
      "Field mapping verified",
      "unknown",
      "verified",
      "A Company Sheets destination is stored, and the published column map was not included in the read."
    );
  }
  if (sheetsConfigured !== true && ghl.fieldMappingComplete === true) {
    return check(
      "field_mapping_verified",
      "Field mapping verified",
      "yes",
      "verified",
      "The GoHighLevel readiness assessment reports every core field mapped. This is not a Google column map."
    );
  }
  if (sheetsConfigured !== true && ghl.fieldMappingComplete === false) {
    return check(
      "field_mapping_verified",
      "Field mapping verified",
      "no",
      "verified",
      "The GoHighLevel readiness assessment still has unmapped core fields."
    );
  }
  if (input.sourceProof.availability !== "ready" || sheetsConfigured === null || published === null) {
    return check(
      "field_mapping_verified",
      "Field mapping verified",
      "unknown",
      "verified",
      "Field-mapping evidence could not be loaded. A setup note is not verification."
    );
  }
  return check(
    "field_mapping_verified",
    "Field mapping verified",
    "no",
    "verified",
    "No published column map or completed GoHighLevel core field map is recorded."
  );
}

function testDeliveryCheck(input: OnboardingDiscoveryInput): DiscoveryCheck {
  if (input.sourceProof.availability !== "ready") {
    return check(
      "test_delivery_verified",
      "Test delivery verified",
      "unknown",
      "verified",
      "Delivery evidence could not be loaded. A setup checkbox or review mark is not a test delivery."
    );
  }
  const delivered = input.sourceProof.sources.some((source) => source.deliverySatisfied);
  if (delivered || input.sourceProof.writerReceiptVerified === true) {
    return check(
      "test_delivery_verified",
      "Test delivery verified",
      "yes",
      "verified",
      "A stored source proof or Sheets writer receipt records a delivery."
    );
  }
  return check(
    "test_delivery_verified",
    "Test delivery verified",
    "no",
    "verified",
    "No stored source proof records a delivery, and no Sheets writer receipt is recorded. A setup checkbox or review mark is not a test delivery."
  );
}

function liveDeliveryCheck(input: OnboardingDiscoveryInput, ghlDeliveryEnabled: boolean): DiscoveryCheck {
  const known = [
    ghlDeliveryEnabled,
    ...input.client.routingRules.map((rule) => rule.deliveryEnabled),
  ];
  if (input.sheetsDispatch.availability === "ready") {
    known.push(input.sheetsDispatch.campaignDispatchEnabled, input.sheetsDispatch.agedDispatchEnabled);
  }
  if (known.some(Boolean)) {
    return check(
      "live_delivery_enabled",
      "Live delivery enabled",
      "yes",
      "recorded",
      "At least one stored destination or routing rule has delivery enabled. This page did not change it."
    );
  }
  if (input.sheetsDispatch.availability !== "ready") {
    return check(
      "live_delivery_enabled",
      "Live delivery enabled",
      "unknown",
      "recorded",
      "Sheets dispatch could not be loaded. GoHighLevel and routing-rule delivery flags that did load are off."
    );
  }
  return check(
    "live_delivery_enabled",
    "Live delivery enabled",
    "no",
    "recorded",
    "Stored GoHighLevel, routing-rule, and Sheets dispatch flags are off."
  );
}

function check(
  id: string,
  label: string,
  state: DiscoveryTriState,
  kind: "recorded" | "verified",
  detail: string
): DiscoveryCheck {
  const statusLabel =
    kind === "verified"
      ? state === "yes"
        ? "Verified"
        : state === "no"
          ? "Not verified"
          : "Unknown"
      : state === "yes"
        ? "Recorded"
        : state === "no"
          ? "Not recorded"
          : "Unknown";
  return { id, label, state, statusLabel, detail };
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
