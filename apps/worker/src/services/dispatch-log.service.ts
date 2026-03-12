import { prisma } from "../lib/db.js";

export async function logDispatchAttempt(args: {
  eventUuid: string;
  attemptNumber: number;
  requestJson?: unknown;
  responseJson?: unknown;
  httpStatus?: number;
  success: boolean;
  errorMessage?: string;
}) {
  return prisma.metaDispatchAttempt.create({
    data: {
      eventUuid: args.eventUuid,
      attemptNumber: args.attemptNumber,
      requestJson: args.requestJson,
      responseJson: args.responseJson,
      httpStatus: args.httpStatus,
      success: args.success,
      errorMessage: args.errorMessage,
    },
  });
}