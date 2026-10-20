/**
 * Admin C.O.C. contract for historical campaign association.
 * The ownership-preview route is registered separately and writes nothing.
 * Confirmation, reassignment, and resale routes stay unregistered.
 *
 * Original-client ownership and resale authorization are different decisions.
 * A preview never stamps `originClientAccountId` and never confirms resale.
 * A client may own many import-scoped labels. One label in one import scope
 * has one confirmed client. The same display text in another import stays a
 * different identity. Client display-name overlap is a suggestion only.
 */

export const HISTORICAL_ASSOCIATION_CONTRACT_ID = "historical-campaign-association-v1" as const;

export const HISTORICAL_ASSOCIATION_AUTH = {
  header: "x-sa360-admin-key",
  auditCredentialAccepted: false,
  featureFlag: "SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED",
  defaultEnabled: false,
} as const;

export const HISTORICAL_ASSOCIATION_ROUTES = {
  ownershipPreview: {
    method: "POST",
    path: "/admin/v1/historical-campaign-associations/ownership-previews",
    writesInventory: false,
    confirmsOwnership: false,
    confirmsResale: false,
    registered: true,
  },
  ownershipConfirm: {
    method: "POST",
    path: "/admin/v1/historical-campaign-associations/ownership-confirmations",
    writesInventory: true,
    confirmsOwnership: true,
    confirmsResale: false,
    confirmationPhrase: "CONFIRM HISTORICAL CAMPAIGN OWNERSHIP",
    registered: false,
  },
  ownershipReassign: {
    method: "POST",
    path: "/admin/v1/historical-campaign-associations/ownership-reassignments",
    writesInventory: true,
    confirmsOwnership: true,
    confirmsResale: false,
    confirmationPhrase: "REASSIGN HISTORICAL CAMPAIGN OWNERSHIP",
    registered: false,
  },
  resalePreview: {
    method: "POST",
    path: "/admin/v1/historical-campaign-resale/previews",
    writesInventory: false,
    confirmsOwnership: false,
    confirmsResale: false,
    registered: false,
  },
  resaleConfirm: {
    method: "POST",
    path: "/admin/v1/historical-campaign-resale/confirmations",
    writesInventory: false,
    confirmsOwnership: false,
    confirmsResale: true,
    confirmationPhrase: "CONFIRM HISTORICAL RESALE AUTHORIZATION",
    registered: false,
  },
} as const;

export type HistoricalAssociationScopeType = "inventory_lot" | "import_request";

export type HistoricalOwnershipPreviewRequest = {
  scopeType?: HistoricalAssociationScopeType;
  scopeKey?: string;
  proposals?: Array<{
    /** July `sourceCampaignName`, normalized by trim and internal whitespace only. */
    normalizedLabel: string;
    originClientAccountId: string;
  }>;
  /**
   * Scope-aware campaign identities. The same normalized label in another
   * import request is a different campaign. Optional per row when
   * `proposedOriginClientAccountId` is set.
   */
  campaigns?: Array<{
    lotKey: string;
    importRequest: string;
    normalizedLabel: string;
    originClientAccountId?: string;
  }>;
  /** Operator CSV. Read once for this preview and not stored. */
  mappingText?: string;
  proposedOriginClientAccountId?: string;
};

export type HistoricalOwnershipPreviewResponse = {
  ok: true;
  contractId: typeof HISTORICAL_ASSOCIATION_CONTRACT_ID;
  stampApplied: false;
  resaleAuthorizationApplied: false;
  clientNameMatchEstablishesOwnership: false;
  scopeType: HistoricalAssociationScopeType;
  scopeKey: string;
  proposals: Array<{
    normalizedLabel: string;
    originClientAccountId: string;
    inventoryRows: number;
    reservedRows: number;
    alreadyStampedToSameClient: number;
    alreadyStampedToOtherClient: number;
    conflictingLabelRows: number;
    ambiguous: boolean;
    conflict: "none" | "duplicate_proposal" | "existing_other_origin" | "conflicting_label_evidence";
  }>;
};

export type HistoricalResalePreviewResponse = {
  ok: true;
  contractId: typeof HISTORICAL_ASSOCIATION_CONTRACT_ID;
  stampApplied: false;
  resaleAuthorizationApplied: false;
  labelAcceptedAsEvidence: false;
  exclusivityAcceptedAsEvidence: false;
  usedByAcceptedAsEvidence: false;
  scopeType: HistoricalAssociationScopeType;
  scopeKey: string;
  historicalRows: number;
  rowsStillMissingOrigin: number;
};
