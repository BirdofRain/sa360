import type { PrismaClient } from "@prisma/client";
import {
  CANONICAL_US_STATE_CODES,
  isCanonicalUsStateCode,
  type CanonicalUsStateCode,
} from "@sa360/shared";

import { prisma as defaultPrisma } from "../../lib/db.js";
import { runWithDependencyTimeout } from "../../lib/admin-route-diagnostics.js";
import { listActiveAgeBandDefinitions } from "../../repositories/lead-inventory.repository.js";
import { adaptPortalNicheKeyForInventoryFilter } from "./client-state-availability-niche.adapter.js";
import { CLIENT_LEADS_ON_DEMAND_CATALOG_SCOPE } from "./lead-inventory-client-availability.service.js";
import { bucketAvailabilityLabel } from "./lead-inventory-client-availability.helpers.js";
import { aggregateLeadInventoryFacetCells } from "./lead-inventory-facets.service.js";
import type { LeadInventoryAgeBand } from "./lead-inventory.constants.js";

/** Hard budget for the single aggregate query; the map degrades instead of hanging. */
export const CLIENT_STATE_AVAILABILITY_TIMEOUT_MS = 8_000;

export type ClientStateAvailabilityLabel = ReturnType<typeof bucketAvailabilityLabel>;

export type ClientStateAvailabilityRow = {
  stateCode: CanonicalUsStateCode;
  availabilityLabel: ClientStateAvailabilityLabel;
};

export type ClientStateAvailabilityFilters = {
  clientAccountId: string;
  nicheKey?: string;
  productType?: string;
};

/**
 * Client-safe, advisory-only read model for the portal US inventory map.
 *
 * - Bucketed labels only (no exact lead counts, no pricing, no item ids).
 * - Every canonical state is present when `dataStatus` is `live`, so the UI
 *   never has to infer "no row means zero".
 * - `unavailable` means the aggregate could not be computed; `states` is empty
 *   rather than a synthesized all-zero map.
 * - Nothing here reserves inventory or touches orders.
 */
export type ClientStateAvailabilityReadModel = {
  catalogScope: typeof CLIENT_LEADS_ON_DEMAND_CATALOG_SCOPE;
  advisory: true;
  filters: { nicheKey: string | null; productType: string | null };
  evaluatedAt: string;
  dataStatus: "live" | "unavailable";
  states: ClientStateAvailabilityRow[];
  /** Number of states per bucket (state counts, not lead counts). */
  summary: Record<ClientStateAvailabilityLabel, number>;
};

type SupplyCell = { state: string; available: bigint | number };

function toInt(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function emptySummary(): Record<ClientStateAvailabilityLabel, number> {
  return { Available: 0, Limited: 0, "Currently unavailable": 0 };
}

/**
 * Fold state × age-band supply cells into one bucketed label per canonical
 * state. Non-canonical geography codes are dropped (never leaked to clients).
 */
export function projectClientStateAvailability(
  cells: ReadonlyArray<SupplyCell>
): Pick<ClientStateAvailabilityReadModel, "states" | "summary"> {
  const availableByState = new Map<CanonicalUsStateCode, number>();
  for (const cell of cells) {
    if (!isCanonicalUsStateCode(cell.state)) continue;
    availableByState.set(
      cell.state,
      (availableByState.get(cell.state) ?? 0) + toInt(cell.available)
    );
  }

  const summary = emptySummary();
  const states: ClientStateAvailabilityRow[] = CANONICAL_US_STATE_CODES.map((stateCode) => {
    const availabilityLabel = bucketAvailabilityLabel(availableByState.get(stateCode) ?? 0);
    summary[availabilityLabel] += 1;
    return { stateCode, availabilityLabel };
  });

  return { states, summary };
}

export type ClientStateAvailabilityDeps = {
  listAgeBandsImpl?: (db: PrismaClient) => Promise<LeadInventoryAgeBand[]>;
  aggregateImpl?: typeof aggregateLeadInventoryFacetCells;
  timeoutMs?: number;
  now?: () => Date;
};

export async function buildClientInventoryStateAvailability(
  filters: ClientStateAvailabilityFilters,
  db: PrismaClient = defaultPrisma,
  deps: ClientStateAvailabilityDeps = {}
): Promise<ClientStateAvailabilityReadModel> {
  const evaluatedAt = (deps.now ?? (() => new Date()))();
  const nicheKey = adaptPortalNicheKeyForInventoryFilter(filters.nicheKey) ?? null;
  const productType = filters.productType?.trim() || null;
  const listAgeBands =
    deps.listAgeBandsImpl ?? ((client: PrismaClient) => listActiveAgeBandDefinitions(undefined, client));
  const aggregate = deps.aggregateImpl ?? aggregateLeadInventoryFacetCells;

  const base = {
    catalogScope: CLIENT_LEADS_ON_DEMAND_CATALOG_SCOPE,
    advisory: true as const,
    filters: { nicheKey, productType },
    evaluatedAt: evaluatedAt.toISOString(),
  };

  const timed = await runWithDependencyTimeout(
    "client_state_availability",
    deps.timeoutMs ?? CLIENT_STATE_AVAILABILITY_TIMEOUT_MS,
    async (signal) => {
      const ageBands = await listAgeBands(db);
      const agg = await aggregate(
        db,
        {
          nicheKey: nicheKey ?? undefined,
          productType: productType ?? undefined,
          status: "available",
        },
        ageBands,
        evaluatedAt,
        signal
      );
      return agg.rows;
    }
  );

  if (!timed.ok) {
    return {
      ...base,
      dataStatus: "unavailable",
      states: [],
      summary: emptySummary(),
    };
  }

  return {
    ...base,
    dataStatus: "live",
    ...projectClientStateAvailability(timed.value),
  };
}
