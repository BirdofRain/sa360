export type PortalSmsOptInPreview = {
  businessName: string;
  program: string;
  purpose: string;
  frequency: string;
  rates: string;
  stop: string;
  help: string;
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
  recordable: boolean;
  consentRecorded: boolean;
  handsetProven: boolean;
  smsEnabled: boolean;
  phoneMasked?: string | null;
  /** staff_supplied is an operator-entered number, not handset proof. */
  phoneSource?: "staff_supplied" | "not_recorded";
  portalLoginRequired?: boolean;
  /** False when this page could not read whether consent is stored. */
  statusKnown?: boolean;
};

export const PORTAL_SMS_OPT_IN_PREVIEW: PortalSmsOptInPreview = {
  businessName: "Life Agent Launch",
  program: "SA360 Delivery Notifications",
  purpose: "operational notification when a delivery webhook is accepted",
  frequency: "Message frequency varies.",
  rates: "Message and data rates may apply.",
  stop: "Reply STOP to opt out.",
  help: "Reply HELP for help.",
  privacyPolicyUrl: null,
  termsUrl: null,
  recordable: false,
  consentRecorded: false,
  handsetProven: false,
  smsEnabled: false,
};
