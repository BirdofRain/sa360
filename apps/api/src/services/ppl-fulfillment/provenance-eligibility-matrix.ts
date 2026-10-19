import { SOURCE_FUNNEL_LEADCAPTURE_PROVIDER } from "../source-intake/source-funnel.service.js";
import {
  CSV_IMPORT_SOURCE_SYSTEM,
  type ProvenanceEligibilityCode,
  type ProvenanceEligibilityInput,
} from "./provenance-eligibility.js";

export type ProvenanceEligibilityCase = {
  name: string;
  input: ProvenanceEligibilityInput;
  code: ProvenanceEligibilityCode;
  eligible: boolean;
};

const leadcapture = SOURCE_FUNNEL_LEADCAPTURE_PROVIDER;

/**
 * Every branch of `evaluateProvenanceEligibility`, including the LeadCapture
 * exception and the `csv_import` short-circuit that beats it.
 */
export const PROVENANCE_ELIGIBILITY_MATRIX: readonly ProvenanceEligibilityCase[] = [
  {
    name: "verified acquisition id wins over csv_import",
    input: {
      verifiedAcquisitionEvidenceId: "acq_verified_1",
      originClientAccountId: null,
      itemSourceProvider: "manual_import",
      eventSourceProvider: "manual_import",
      eventSourceSystem: CSV_IMPORT_SOURCE_SYSTEM,
    },
    code: "eligible_verified_acquisition",
    eligible: true,
  },
  {
    name: "whitespace verified id is absent",
    input: {
      verifiedAcquisitionEvidenceId: "   ",
      originClientAccountId: null,
      itemSourceProvider: "manual_import",
      eventSourceProvider: "manual_import",
      eventSourceSystem: CSV_IMPORT_SOURCE_SYSTEM,
    },
    code: "unresolved_origin",
    eligible: false,
  },
  {
    name: "trimmed verified id is present",
    input: {
      verifiedAcquisitionEvidenceId: "  acq_verified_2  ",
      eventSourceSystem: CSV_IMPORT_SOURCE_SYSTEM,
    },
    code: "eligible_verified_acquisition",
    eligible: true,
  },
  {
    name: "confirmed origin wins over csv_import",
    input: {
      originClientAccountId: "client_origin",
      itemSourceProvider: "manual_import",
      eventSourceProvider: "manual_import",
      eventSourceSystem: CSV_IMPORT_SOURCE_SYSTEM,
      verifiedAcquisitionEvidenceId: null,
    },
    code: "eligible_confirmed_origin",
    eligible: true,
  },
  {
    name: "whitespace origin is absent",
    input: {
      originClientAccountId: "  ",
      verifiedAcquisitionEvidenceId: "",
      itemSourceProvider: leadcapture,
      eventSourceProvider: "manual_import",
    },
    code: "unresolved_origin",
    eligible: false,
  },
  {
    name: "trimmed origin is confirmed",
    input: { originClientAccountId: "  client_origin  ", eventSourceSystem: CSV_IMPORT_SOURCE_SYSTEM },
    code: "eligible_confirmed_origin",
    eligible: true,
  },
  {
    name: "csv_import beats unstamped LeadCapture providers",
    input: {
      originClientAccountId: null,
      verifiedAcquisitionEvidenceId: null,
      itemSourceProvider: leadcapture,
      eventSourceProvider: leadcapture,
      eventSourceSystem: CSV_IMPORT_SOURCE_SYSTEM,
    },
    code: "unresolved_origin",
    eligible: false,
  },
  {
    name: "csv_import manual_import is unresolved",
    input: {
      itemSourceProvider: "manual_import",
      eventSourceProvider: "manual_import",
      eventSourceSystem: CSV_IMPORT_SOURCE_SYSTEM,
    },
    code: "unresolved_origin",
    eligible: false,
  },
  {
    name: "trimmed csv_import system is the exception",
    input: {
      itemSourceProvider: leadcapture,
      eventSourceProvider: leadcapture,
      eventSourceSystem: "  csv_import  ",
    },
    code: "unresolved_origin",
    eligible: false,
  },
  {
    name: "uppercase CSV_IMPORT is not the csv_import exception",
    input: {
      itemSourceProvider: leadcapture,
      eventSourceProvider: leadcapture,
      eventSourceSystem: "CSV_IMPORT",
    },
    code: "eligible_leadcapture_unstamped",
    eligible: true,
  },
  {
    name: "both LeadCapture providers stay eligible",
    input: {
      itemSourceProvider: leadcapture,
      eventSourceProvider: leadcapture,
      eventSourceSystem: "leadcapture_io_nextgen",
    },
    code: "eligible_leadcapture_unstamped",
    eligible: true,
  },
  {
    name: "trimmed LeadCapture providers stay eligible",
    input: {
      itemSourceProvider: `  ${leadcapture}  `,
      eventSourceProvider: ` ${leadcapture}`,
      eventSourceSystem: "webhook",
    },
    code: "eligible_leadcapture_unstamped",
    eligible: true,
  },
  {
    name: "item LeadCapture provider alone stays eligible",
    input: { itemSourceProvider: leadcapture, eventSourceProvider: null, eventSourceSystem: "webhook" },
    code: "eligible_leadcapture_unstamped",
    eligible: true,
  },
  {
    name: "event LeadCapture provider alone stays eligible",
    input: { itemSourceProvider: "  ", eventSourceProvider: leadcapture, eventSourceSystem: null },
    code: "eligible_leadcapture_unstamped",
    eligible: true,
  },
  {
    name: "LeadCapture and another provider disagree",
    input: {
      itemSourceProvider: leadcapture,
      eventSourceProvider: "manual_import",
      eventSourceSystem: "leadcapture_io_legacy",
    },
    code: "unresolved_origin",
    eligible: false,
  },
  {
    name: "facebook is unresolved",
    input: { itemSourceProvider: "facebook", eventSourceProvider: "facebook", eventSourceSystem: "meta_lead_ads" },
    code: "unresolved_origin",
    eligible: false,
  },
  {
    name: "missing providers and system are unresolved",
    input: {},
    code: "unresolved_origin",
    eligible: false,
  },
  {
    name: "whitespace providers are unresolved",
    input: { itemSourceProvider: " ", eventSourceProvider: " ", eventSourceSystem: " " },
    code: "unresolved_origin",
    eligible: false,
  },
];
