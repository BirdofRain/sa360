export const CONFIRMATION: string;
export const DEFAULT_CHUNK_SIZE: number;
export const MAX_CHUNK_SIZE: number;
export const MAX_CHUNKS_PER_RUN: number;
export const STATEMENT_TIMEOUT: string;
export const LOCK_TIMEOUT: string;
export const CHECKPOINT_VERSION: number;

export type SanitizedDatabaseError = {
  outcome: "STOPPED";
  ok: false;
  reasonCode: string;
  driverCode?: string;
  prismaCode?: string;
  durationMs?: number;
};

export function sanitizeDatabaseError(error: unknown, durationMs?: number): SanitizedDatabaseError;

export function databaseNameFromUrl(databaseUrl: string): string;

export function parseArgs(argv: string[]): Record<string, string>;

export function databaseEndpoint(
  databaseUrl: string,
): { host: string; port: string } | null;

export function isLoopback(host: string): boolean;

export function validateInvocation(
  raw: Record<string, string | undefined>,
  env: NodeJS.ProcessEnv,
): {
  error?: {
    outcome: "REFUSED";
    ok: false;
    reasonCode: string;
    field: string | null;
    reason: string;
    writesAttempted: false;
    readyChanged: false;
  };
  options?: Record<string, unknown>;
};

type CatalogStatement = {
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
  $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
};

export function withCatalogSession<T>(
  db: unknown,
  readOnly: boolean,
  fn: (tx: CatalogStatement) => Promise<T>,
): Promise<T>;

export function runHistoricalCatalogBackfill(
  options: Record<string, unknown>,
): Promise<Record<string, unknown>>;
