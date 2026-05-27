export const DELIVERY_PLAN_STATUSES = [
  "planned",
  "needs_config",
  "blocked",
  "ready_for_review",
  "ignored_test",
] as const;

export const DELIVERY_PLAN_STEP_STATUSES = [
  "planned",
  "skipped",
  "blocked",
  "needs_config",
] as const;

export const DELIVERY_PLAN_STEP_TYPES = [
  "normalize_lead",
  "dedupe_check",
  "create_or_update_contact",
  "stamp_custom_fields",
  "add_tags",
  "create_or_update_opportunity",
  "assign_owner",
  "start_workflow",
  "write_backup_sheet",
  "emit_lifecycle_event",
  "mark_ready_for_delivery_review",
] as const;

export type DeliveryPlanStatus = (typeof DELIVERY_PLAN_STATUSES)[number];
export type DeliveryPlanStepStatus = (typeof DELIVERY_PLAN_STEP_STATUSES)[number];
export type DeliveryPlanStepType = (typeof DELIVERY_PLAN_STEP_TYPES)[number];
