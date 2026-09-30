export type FacebookFormAssociationItem = {
  id: string;
  pageId: string;
  formId: string;
  formName: string | null;
  clientAccountId: string;
  associationStatus: "confirmed";
  providerFunnelId: string;
};

export type AssociateFacebookFormResult =
  | {
      ok: true;
      created: boolean;
      ownershipUnchanged: boolean;
      item: FacebookFormAssociationItem;
    }
  | { ok: false; error: string; code?: string };

export type ReevaluateFacebookCaptureResult =
  | {
      ok: true;
      sourceEventId: string;
      unchanged: boolean;
      associationOutcome: string;
      clientAccountId: string | null;
      explanation: string;
      thisRequestInventoryTracked: false;
      thisRequestDeliveryAttempted: false;
      historicalDeliveryOutcome: string;
    }
  | { ok: false; error: string; code?: string };
