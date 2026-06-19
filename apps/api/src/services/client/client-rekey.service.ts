import type { Prisma } from "@prisma/client";
import { isClientRekeyConfirmationValid } from "@sa360/shared";
import { prisma } from "../../lib/db.js";
import { GHL_CONNECTION_CONNECTED } from "../../lib/delivery-readiness-status.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import {
  countClientIdentityReferences,
  migrateClientIdentityReferences,
} from "./client-rekey-references.js";

export type ClientRekeyPreview = {
  sourceClientAccountId: string;
  targetClientAccountId: string;
  sourceExists: boolean;
  targetExists: boolean;
  locationIds: string[];
  references: Record<string, number>;
  conflicts: string[];
  safeToExecute: boolean;
};

export type ClientRekeyResult = {
  sourceClientAccountId: string;
  targetClientAccountId: string;
  movedReferences: Record<string, number>;
  locationIds: string[];
  sourceRemoved: boolean;
  validation: {
    targetExists: boolean;
    sourceReferencesRemaining: number;
    locationLinkedToTarget: boolean;
    destinationOwnedByTarget: boolean;
    oauthConnected: boolean;
  };
};

export class ClientRekeyConflictError extends Error {
  readonly code = "client_rekey_conflict";
  readonly conflicts: string[];

  constructor(conflicts: string[]) {
    super(conflicts.join(" "));
    this.name = "ClientRekeyConflictError";
    this.conflicts = conflicts;
  }
}

function destinationLocationIds(
  client: Awaited<ReturnType<typeof findClientAccountById>>
): string[] {
  const locationId = client?.ghlDestination?.destinationSubaccountIdGhl?.trim();
  return locationId ? [locationId] : [];
}

function analyzeTargetExistsConflicts(
  source: NonNullable<Awaited<ReturnType<typeof findClientAccountById>>>,
  target: NonNullable<Awaited<ReturnType<typeof findClientAccountById>>>
): string[] {
  const conflicts: string[] = [];
  if (target.ghlDestination && source.ghlDestination) {
    const targetLoc = target.ghlDestination.destinationSubaccountIdGhl.trim();
    const sourceLoc = source.ghlDestination.destinationSubaccountIdGhl.trim();
    if (targetLoc && sourceLoc && targetLoc !== sourceLoc) {
      conflicts.push(
        `Target client already has destination location ${targetLoc}, which differs from source location ${sourceLoc}.`
      );
    }
  }
  if (target.portalLoginEmail && source.portalLoginEmail && target.portalLoginEmail !== source.portalLoginEmail) {
    conflicts.push("Target and source both define different portal login emails.");
  }
  return conflicts;
}

export async function previewClientIdentityRekey(
  sourceClientAccountId: string,
  targetClientAccountId: string
): Promise<ClientRekeyPreview> {
  const sourceId = sourceClientAccountId.trim();
  const targetId = targetClientAccountId.trim();
  const source = await findClientAccountById(sourceId);
  const target = await findClientAccountById(targetId);
  const references = source ? await countClientIdentityReferences(sourceId, prisma) : {};
  const conflicts: string[] = [];

  if (!source) {
    conflicts.push(`Source client ${sourceId} was not found.`);
  }
  if (sourceId === targetId) {
    conflicts.push("Source and target client IDs must differ.");
  }
  if (target) {
    conflicts.push(...analyzeTargetExistsConflicts(source!, target));
  }

  return {
    sourceClientAccountId: sourceId,
    targetClientAccountId: targetId,
    sourceExists: Boolean(source),
    targetExists: Boolean(target),
    locationIds: destinationLocationIds(source),
    references,
    conflicts,
    safeToExecute: Boolean(source) && sourceId !== targetId && conflicts.length === 0,
  };
}

function omitDestinationRelation<T extends { id: string; clientAccountId: string }>(
  dest: T
): Omit<T, "id" | "clientAccountId"> {
  const { id: _id, clientAccountId: _clientAccountId, ...rest } = dest;
  return rest;
}

async function assertPostRekeyState(
  tx: Prisma.TransactionClient,
  targetId: string,
  sourceId: string,
  locationId: string
) {
  const target = await tx.clientAccount.findUnique({
    where: { clientAccountId: targetId },
    include: { ghlDestination: true },
  });
  if (!target) {
    throw new ClientRekeyConflictError(["Target client was not created."]);
  }

  const sourceRemaining = await countClientIdentityReferences(sourceId, tx);
  const sourceReferencesRemaining = Object.values(sourceRemaining).reduce((sum, n) => sum + n, 0);
  if (sourceReferencesRemaining > 0) {
    throw new ClientRekeyConflictError([
      `Source client ${sourceId} still has ${sourceReferencesRemaining} dependent reference(s).`,
    ]);
  }

  const sourceAccount = await tx.clientAccount.findUnique({ where: { clientAccountId: sourceId } });
  if (sourceAccount) {
    throw new ClientRekeyConflictError([`Source client ${sourceId} was not removed.`]);
  }

  const connection = await tx.ghlLocationConnection.findUnique({ where: { locationId } });
  if (!connection || connection.clientAccountId !== targetId) {
    throw new ClientRekeyConflictError([
      `GHL location ${locationId} is not linked to ${targetId} after rekey.`,
    ]);
  }

  const destination = target.ghlDestination;
  if (!destination || destination.destinationSubaccountIdGhl.trim() !== locationId) {
    throw new ClientRekeyConflictError([
      `ClientGhlDestination for ${targetId} does not own location ${locationId}.`,
    ]);
  }

  const oauthConnected =
    connection.connectionStatus?.toLowerCase() === GHL_CONNECTION_CONNECTED ||
    destination.ghlConnectionStatus?.toLowerCase() === GHL_CONNECTION_CONNECTED;
  if (!oauthConnected) {
    throw new ClientRekeyConflictError(["OAuth connection is not connected after rekey."]);
  }

  return {
    targetExists: true,
    sourceReferencesRemaining,
    locationLinkedToTarget: true,
    destinationOwnedByTarget: true,
    oauthConnected,
  };
}

export async function executeClientIdentityRekey(input: {
  sourceClientAccountId: string;
  targetClientAccountId: string;
  confirmation: string;
}): Promise<ClientRekeyResult> {
  const sourceId = input.sourceClientAccountId.trim();
  const targetId = input.targetClientAccountId.trim();

  if (!isClientRekeyConfirmationValid(sourceId, targetId, input.confirmation)) {
    throw new Error("confirmation_invalid");
  }

  const preview = await previewClientIdentityRekey(sourceId, targetId);
  if (!preview.safeToExecute) {
    throw new ClientRekeyConflictError(
      preview.conflicts.length ? preview.conflicts : ["Rekey preview is not safe to execute."]
    );
  }

  const source = await findClientAccountById(sourceId);
  if (!source?.ghlDestination) {
    throw new Error("source_destination_missing");
  }

  const locationId = source.ghlDestination.destinationSubaccountIdGhl.trim();
  const sourceDest = source.ghlDestination;

  const result = await prisma.$transaction(async (tx) => {
    const target = await tx.clientAccount.findUnique({ where: { clientAccountId: targetId } });
    if (target) {
      throw new ClientRekeyConflictError([
        `Target client ${targetId} already exists. Explicit merge strategy is required.`,
      ]);
    }

    await tx.clientAccount.create({
      data: {
        clientAccountId: targetId,
        clientDisplayName: source.clientDisplayName,
        status: source.status,
        portalEnabled: source.portalEnabled,
        portalDisplayName: source.portalDisplayName,
        portalLoginEmail: source.portalLoginEmail,
        primaryNicheKeys: source.primaryNicheKeys ?? [],
        primaryProductTypes: source.primaryProductTypes ?? [],
        notes: source.notes,
      },
    });

    await tx.clientGhlDestination.create({
      data: {
        ...(omitDestinationRelation(sourceDest) as Prisma.ClientGhlDestinationCreateWithoutClientAccountInput),
        clientAccount: { connect: { clientAccountId: targetId } },
      },
    });

    const movedReferences = await migrateClientIdentityReferences(sourceId, targetId, tx);

    await tx.clientGhlDestination.delete({ where: { clientAccountId: sourceId } });
    await tx.clientAccount.delete({ where: { clientAccountId: sourceId } });

    const validation = await assertPostRekeyState(tx, targetId, sourceId, locationId);

    return {
      sourceClientAccountId: sourceId,
      targetClientAccountId: targetId,
      movedReferences,
      locationIds: [locationId],
      sourceRemoved: true,
      validation,
    };
  });

  return result;
}
