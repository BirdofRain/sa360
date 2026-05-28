import type { Prisma } from "@prisma/client";
import type { RoutingDryRunValidationPatch } from "../schemas/routing.schema.js";
import {
  findRoutingDryRunDecisionById,
  updateRoutingDryRunDecisionValidation,
} from "../repositories/routing-dry-run-decision.repository.js";
import {
  presentRoutingDryRunDecision,
  type RoutingDryRunDecisionItem,
} from "./routing-dry-run-admin.present.js";

export function buildRoutingValidationUpdate(
  patch: RoutingDryRunValidationPatch,
  now: Date = new Date()
): Prisma.RoutingDryRunDecisionUpdateInput {
  const isReviewed = patch.validationStatus !== "unreviewed";
  return {
    validationStatus: patch.validationStatus,
    legacyDeliveredClientAccountId: patch.legacyDeliveredClientAccountId ?? null,
    legacyDeliveredSubaccountIdGhl: patch.legacyDeliveredSubaccountIdGhl ?? null,
    legacyDeliveryContactIdGhl: patch.legacyDeliveryContactIdGhl ?? null,
    legacyDeliveryStatus: patch.legacyDeliveryStatus ?? null,
    validationNotes: patch.validationNotes ?? null,
    validatedBy: isReviewed ? (patch.validatedBy?.trim() || "coc_operator") : null,
    validatedAt: isReviewed ? now : null,
  };
}

export async function updateRoutingDryRunValidation(
  decisionId: string,
  patch: RoutingDryRunValidationPatch,
  now: () => Date = () => new Date()
): Promise<{ item: RoutingDryRunDecisionItem } | { notFound: true }> {
  const existing = await findRoutingDryRunDecisionById(decisionId.trim());
  if (!existing) return { notFound: true };

  const row = await updateRoutingDryRunDecisionValidation(
    existing.id,
    buildRoutingValidationUpdate(patch, now())
  );
  const item = await presentRoutingDryRunDecision(row);
  return { item };
}
