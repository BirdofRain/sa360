/**
 * Lane B reads this after a persisted http_accepted attempt.
 * acceptanceId is the attempt id. acceptedAt is httpAcceptedAt, the database
 * timestamp written once when outcome first became http_accepted.
 * updatedAt is not that clock. This function does not send email or SMS.
 */

export type ExternalWebhookAcceptanceEvent = {
  acceptanceId: string;
  clientAccountId: string;
  sourceLeadEventId: string;
  destinationId: string;
  attemptId: string;
  httpStatus: number;
  acceptedAt: string;
};

export function externalWebhookAcceptanceEvent(row: {
  id: string;
  clientAccountId: string;
  sourceLeadEventId: string;
  destinationId: string;
  state: string;
  outcome: string | null;
  httpStatus: number | null;
  requestLeftSa360: boolean;
  httpAcceptedAt: Date | null;
}): ExternalWebhookAcceptanceEvent | null {
  if (row.state !== "attempted" || row.outcome !== "http_accepted") return null;
  if (row.requestLeftSa360 !== true) return null;
  if (row.httpStatus === null || row.httpStatus < 200 || row.httpStatus > 299) return null;
  if (row.httpAcceptedAt == null) return null;
  return {
    acceptanceId: row.id,
    attemptId: row.id,
    clientAccountId: row.clientAccountId,
    sourceLeadEventId: row.sourceLeadEventId,
    destinationId: row.destinationId,
    httpStatus: row.httpStatus,
    acceptedAt: row.httpAcceptedAt.toISOString(),
  };
}
