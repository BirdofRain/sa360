/**
 * Pure client-folder decisions. Google and the database stay outside this function
 * so a retry can be classified without creating another folder.
 */

export type ClientFolderRecord = {
  folderId: string | null;
  folderTitle: string;
  status: "active" | "unlinked" | "creating" | "unknown";
};

export type ClientFolderMatch = {
  folderId: string;
  title: string;
  source: "recorded" | "name";
};

export type ClientFolderDecision =
  | { action: "reuse"; folderId: string; title: string }
  | { action: "offer"; folders: ClientFolderMatch[] }
  | { action: "create" }
  | { action: "in_progress" }
  | { action: "unknown" }
  | { action: "link"; folderId: string }
  | {
      action: "reject";
      code: "ambiguous_client_folder" | "recorded_folder_unavailable" | "invalid_folder" | "folder_not_in_parent";
      folders?: ClientFolderMatch[];
    };

const FRESH_CLAIM_MS = 120_000;

export function clientFolderClaimIsFresh(updatedAt: Date, now: Date): boolean {
  return now.getTime() - updatedAt.getTime() < FRESH_CLAIM_MS;
}

export function decideClientFolderAction(input: {
  intent: "inspect" | "link" | "create";
  requestedFolderId?: string | null;
  recorded: ClientFolderRecord | null;
  nameMatches: ReadonlyArray<{ folderId: string; title: string }>;
  claimHeldByOther: boolean;
  recordedFolderValid: boolean | null;
  ancestryVerifiedFolderId?: string | null;
  nameListTruncated?: boolean;
}): ClientFolderDecision {
  if (input.nameListTruncated && input.intent !== "link") {
    return {
      action: "reject",
      code: "ambiguous_client_folder",
      folders: dedupeMatches(input.recorded, input.nameMatches),
    };
  }
  if (input.intent === "inspect") {
    return { action: "offer", folders: dedupeMatches(input.recorded, input.nameMatches) };
  }
  if (input.intent === "link") {
    const requested = input.requestedFolderId?.trim() ?? "";
    if (!requested) return { action: "reject", code: "invalid_folder" };
    const allowed = new Set(dedupeMatches(input.recorded, input.nameMatches).map((folder) => folder.folderId));
    if (input.ancestryVerifiedFolderId && input.ancestryVerifiedFolderId === requested) allowed.add(requested);
    if (!allowed.has(requested)) return { action: "reject", code: "folder_not_in_parent" };
    return { action: "link", folderId: requested };
  }
  if (input.claimHeldByOther) return { action: "in_progress" };
  if (input.recorded?.status === "active" && input.recorded.folderId) {
    if (input.recordedFolderValid === false) return { action: "reject", code: "recorded_folder_unavailable" };
    return { action: "reuse", folderId: input.recorded.folderId, title: input.recorded.folderTitle };
  }
  if (input.recorded?.status === "unknown") {
    return classifyMatches(dedupeMatches(input.recorded, input.nameMatches), "unknown");
  }
  return classifyMatches(dedupeMatches(input.recorded, input.nameMatches), "create");
}

function classifyMatches(
  folders: ClientFolderMatch[],
  emptyAction: "unknown" | "create"
): ClientFolderDecision {
  if (folders.length > 1) return { action: "reject", code: "ambiguous_client_folder", folders };
  if (folders.length === 1) return { action: "offer", folders };
  return emptyAction === "unknown" ? { action: "unknown" } : { action: "create" };
}

function dedupeMatches(
  recorded: ClientFolderRecord | null,
  nameMatches: ReadonlyArray<{ folderId: string; title: string }>
): ClientFolderMatch[] {
  const folders: ClientFolderMatch[] = [];
  const seen = new Set<string>();
  if (recorded?.folderId && recorded.status !== "creating") {
    seen.add(recorded.folderId);
    folders.push({
      folderId: recorded.folderId,
      title: recorded.folderTitle || recorded.folderId,
      source: "recorded",
    });
  }
  for (const match of nameMatches) {
    if (!match.folderId || seen.has(match.folderId)) continue;
    seen.add(match.folderId);
    folders.push({ folderId: match.folderId, title: match.title, source: "name" });
  }
  return folders;
}
