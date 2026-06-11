/** Logical delivery plan types (Phase 4D shadow vs Phase 5C direct canary). */
export const DELIVERY_PLAN_TYPES = {
  SHADOW: "shadow_plan",
  ADAPTER_SIMULATION: "adapter_simulation_plan",
  LIVE_CANARY: "live_canary_plan",
} as const;

export type DeliveryPlanType = (typeof DELIVERY_PLAN_TYPES)[keyof typeof DELIVERY_PLAN_TYPES];

/** Stored on LeadDeliveryPlan.deliveryMode */
export const DELIVERY_PLAN_DELIVERY_MODES = {
  SHADOW: "shadow",
  DIRECT_CANARY: "direct_canary",
} as const;

export const DELIVERY_PLAN_GENERATED_BY = {
  SHADOW: "sa360_shadow_delivery",
  DIRECT_CANARY: "sa360_direct_canary_delivery",
} as const;

export function planTypeFromDeliveryPlan(plan: {
  deliveryMode: string;
  generatedBy: string;
}): DeliveryPlanType {
  if (
    plan.deliveryMode === DELIVERY_PLAN_DELIVERY_MODES.DIRECT_CANARY ||
    plan.generatedBy === DELIVERY_PLAN_GENERATED_BY.DIRECT_CANARY
  ) {
    return DELIVERY_PLAN_TYPES.ADAPTER_SIMULATION;
  }
  return DELIVERY_PLAN_TYPES.SHADOW;
}

export function planPathLabel(planType: DeliveryPlanType): "shadow_plan" | "adapter_plan" {
  return planType === DELIVERY_PLAN_TYPES.SHADOW ? "shadow_plan" : "adapter_plan";
}
