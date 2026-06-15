import type { ClientGhlDestination } from "@/lib/clients/types";
import type { DeliveryReadinessAssessment } from "@/lib/clients/types";
import type { GhlLocationConnectionItem } from "@/lib/ghl-connections/types";

export type ClientDeliveryConfigSummary = {
  clientAccountId: string;
  clientDisplayName: string;
  locationId: string | null;
  locationName: string | null;
  connection: GhlLocationConnectionItem | null;
  ghlDestination: ClientGhlDestination | null;
  destinationReadiness: DeliveryReadinessAssessment | null;
  locationMismatch: boolean;
  issueCodes: string[];
  discoverySummary: Record<string, unknown> | null;
};

export type ClientDeliveryConfigResponse = {
  ok: boolean;
} & ClientDeliveryConfigSummary;

export type ClientGhlConfigSaveResponse = {
  ok: boolean;
  ghlDestination: ClientGhlDestination;
  destinationReadiness: DeliveryReadinessAssessment;
};
