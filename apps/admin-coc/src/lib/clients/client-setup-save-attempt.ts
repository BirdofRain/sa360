import type { ClientSetupData } from "./types";

export type ClientSetupSaveIntent =
  | "save_draft"
  | "submit"
  | "needs_information"
  | "setup_reviewed"
  | "recover_draft";

export type ClientSetupSaveAttempt = {
  key: string;
  requestId: string;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

export function clientSetupSaveAttempt(
  previous: ClientSetupSaveAttempt | null,
  intent: ClientSetupSaveIntent,
  data: ClientSetupData,
  expectedRevision: number,
  newRequestId: () => string = () => crypto.randomUUID()
): ClientSetupSaveAttempt {
  const key = JSON.stringify(canonicalize({ intent, data, expectedRevision }));
  return previous?.key === key ? previous : { key, requestId: newRequestId() };
}
