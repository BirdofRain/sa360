import "server-only";

import { fetchAdminFrontOfficeTrust } from "@/lib/admin-api/server";

import { getMockTrustCenter } from "../mock/trust";
import type { TrustCenterResponse } from "../types";
import type { LiveBridgeScope } from "./config";
import { isFrontOfficeLiveBridgeEnabled } from "./config";
import { resolveDataSource } from "./data-source";
import { sanitizeTrustCenter } from "./sanitize";
import {
  fetchTrustLiveSlices,
  mergeCard,
  BUILDERS,
  CARD_KEYS,
} from "./trust-adapter-legacy";
import {
  isCompositeTrustUsable,
  mapCompositeTrustToFrontOffice,
} from "./front-office-composite-bridge";

export async function getTrustCenterComposite(
  scope: LiveBridgeScope
): Promise<TrustCenterResponse | null> {
  if (!isFrontOfficeLiveBridgeEnabled(scope.role)) return null;

  const params: Record<string, string> = {};
  if (scope.clientAccountId) params.clientAccountId = scope.clientAccountId;

  try {
    const { data, error } = await fetchAdminFrontOfficeTrust(params);
    if (error || !data) return null;
    if (!isCompositeTrustUsable(data.cards)) return null;
    return sanitizeTrustCenter(mapCompositeTrustToFrontOffice(data), scope.role);
  } catch {
    return null;
  }
}

export async function getTrustCenterLegacy(scope: LiveBridgeScope): Promise<TrustCenterResponse> {
  const mockBase = getMockTrustCenter(scope.role);
  const mockByKey = new Map(mockBase.cards.map((c) => [c.key, c]));

  if (!isFrontOfficeLiveBridgeEnabled(scope.role)) {
    return sanitizeTrustCenter(
      { cards: CARD_KEYS.map((k) => mockByKey.get(k)!).filter(Boolean), dataSource: "mock" },
      scope.role
    );
  }

  const now = new Date().toISOString();
  let slices: Awaited<ReturnType<typeof fetchTrustLiveSlices>>;
  try {
    slices = await fetchTrustLiveSlices(scope);
  } catch {
    return sanitizeTrustCenter({ ...mockBase, dataSource: "mock" }, scope.role);
  }

  let liveCount = 0;
  const cards = CARD_KEYS.map((key) => {
    const mock =
      mockByKey.get(key) ??
      ({
        key,
        label: key,
        status: "mock" as const,
        headline: "Preview fallback",
        lastCheckedAt: now,
        checks: [],
        source: "mock" as const,
      } satisfies import("../types").TrustCheckCard);
    const live = BUILDERS[key](slices, now);
    if (live) liveCount += 1;
    return mergeCard(key, live, mock);
  });

  return sanitizeTrustCenter(
    { cards, dataSource: resolveDataSource(liveCount, CARD_KEYS.length) },
    scope.role
  );
}

export async function getTrustCenterLive(scope: LiveBridgeScope): Promise<TrustCenterResponse> {
  const composite = await getTrustCenterComposite(scope);
  if (composite) return composite;
  return getTrustCenterLegacy(scope);
}
