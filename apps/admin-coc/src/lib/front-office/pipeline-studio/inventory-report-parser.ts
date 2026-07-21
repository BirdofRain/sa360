/**
 * Re-export shared Lead Processor aggregate inventory parser.
 * Semantics must remain identical to @sa360/shared.
 */
export {
  parseAndValidateAggregateInventoryCsv,
  parseLeadProcessorDate,
  type AgeBucketKey,
  type AggregateBucketTotals,
  type AggregateGeographyRow,
  type GeographyClassification,
  type InventoryReportValidation,
  type LeadProcessorReportMetadata,
  type ReportCompleteness,
} from "@sa360/shared";
