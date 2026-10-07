/**
 * Routing authority: confirmed LeadCapture client source association.
 *
 * `CampaignRoutingRule` stays the primary destination resolver. This authority
 * only answers "which client did an operator explicitly confirm owns this exact
 * LeadCapture page / form?" and is consulted when no exact rule tier matched.
 *
 * It resolves a destination without creating or widening a routing rule, so a
 * single-page association can never become a broad rule. Delivery is untouched:
 * the decision is still a dry-run decision and delivery remains explicitly
 * operator-approved.
 */

import type { PrismaClient } from "@prisma/client";

import { prisma } from "../lib/db.js";
import type { LifecycleEventSchema } from "../schemas/lifecycle-event.schema.js";
import { findClientAccountById } from "../repositories/client-account.repository.js";
import {
  resolveConfirmedLeadCaptureSourceAssociation,
  type LeadCaptureSourceAssociationMatch,
  type LeadCaptureSourceAssociationUnmatchedReason,
} from "./source-intake/leadcapture-source-association.service.js";
import { leadCaptureSourceIdentitySignalsFromLifecyclePayload } from "./source-intake/leadcapture-source-identity-signals.js";

export const LEADCAPTURE_SOURCE_PLATFORM = "leadcapture_io" as const;

export const ROUTING_AUTHORITY_CAMPAIGN_RULE = "campaign_routing_rule" as const;
export const ROUTING_AUTHORITY_SOURCE_ASSOCIATION = "confirmed_source_association" as const;
export const ROUTING_AUTHORITY_OPERATOR_DESTINATION = "operator_selected_destination" as const;

export type RoutingAuthority =
  | typeof ROUTING_AUTHORITY_CAMPAIGN_RULE
  | typeof ROUTING_AUTHORITY_SOURCE_ASSOCIATION
  | typeof ROUTING_AUTHORITY_OPERATOR_DESTINATION;

export type RoutingSourceAssociationDestination = {
  destinationClientAccountId: string;
  destinationSubaccountIdGhl: string;
  clientDisplayName: string | null;
  match: LeadCaptureSourceAssociationMatch;
};

export type RoutingSourceAssociationUnresolvedReason =
  | LeadCaptureSourceAssociationUnmatchedReason
  | "not_leadcapture_source"
  | "origin_client_missing";

export type RoutingSourceAssociationOutcome =
  | { resolved: true; destination: RoutingSourceAssociationDestination }
  | {
      resolved: false;
      reason: RoutingSourceAssociationUnresolvedReason;
      candidateSourceFunnelIds: string[];
    };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Only LeadCapture events are eligible; other providers are left to rules. */
export function isLeadCaptureSourcedPayload(payload: LifecycleEventSchema): boolean {
  if (payload.attribution?.source_platform?.trim() === LEADCAPTURE_SOURCE_PLATFORM) return true;
  const sourceIntake = asRecord(asRecord(payload.routing)?.source_intake);
  const provider = sourceIntake?.provider;
  return typeof provider === "string" && provider.trim() === LEADCAPTURE_SOURCE_PLATFORM;
}

export function sourceAssociationMatchReason(
  destination: RoutingSourceAssociationDestination
): string {
  const owner = destination.clientDisplayName?.trim() || destination.destinationClientAccountId;
  return `Matched confirmed LeadCapture source association (${destination.match.matchedBy}: ${destination.match.matchEvidence}) → ${owner}`;
}

/**
 * Resolve the destination client for a lifecycle payload from the confirmed
 * source association registry. Read-only and fail-closed.
 */
export async function resolveRoutingDestinationFromConfirmedSourceAssociation(
  payload: LifecycleEventSchema,
  db: PrismaClient = prisma
): Promise<RoutingSourceAssociationOutcome> {
  if (!isLeadCaptureSourcedPayload(payload)) {
    return { resolved: false, reason: "not_leadcapture_source", candidateSourceFunnelIds: [] };
  }

  const signals = leadCaptureSourceIdentitySignalsFromLifecyclePayload(payload);
  const association = await resolveConfirmedLeadCaptureSourceAssociation(signals, db);
  if (!association.matched) {
    return {
      resolved: false,
      reason: association.reason,
      candidateSourceFunnelIds: association.candidateSourceFunnelIds,
    };
  }

  const client = await findClientAccountById(association.match.originClientAccountId, db);
  if (!client) {
    return {
      resolved: false,
      reason: "origin_client_missing",
      candidateSourceFunnelIds: [association.match.sourceFunnelId],
    };
  }

  return {
    resolved: true,
    destination: {
      destinationClientAccountId: client.clientAccountId,
      destinationSubaccountIdGhl: client.ghlDestination?.destinationSubaccountIdGhl?.trim() || "",
      clientDisplayName: client.clientDisplayName ?? null,
      match: association.match,
    },
  };
}
