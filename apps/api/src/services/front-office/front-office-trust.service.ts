import { listCampaignRoutingRules } from "../../repositories/campaign-routing-rule.repository.js";
import { resolveSummaryDateRange } from "../../schemas/admin.schema.js";
import { resolveAutomationDashboardDateRange } from "../../schemas/automation-dashboard.schema.js";
import { getAdminMetricsSummary } from "../admin-metrics.service.js";
import { getAutomationSignalHealth } from "../automation-dashboard.service.js";
import { presentRoutingRulesWithReadinessEnriched } from "../delivery-readiness-admin.present.js";
import { listGhlConnectionsPresented } from "../ghl-oauth/ghl-connection.service.js";
import { presentGhlLocationConnectionForAdmin } from "../ghl-oauth/ghl-oauth-admin.present.js";
import {
  mockTrustCard,
  TRUST_CARD_BUILDERS,
  type TrustSliceData,
} from "./front-office-trust-builders.js";
import {
  FRONT_OFFICE_TRUST_CARD_KEYS,
  type FrontOfficeDataSource,
  type FrontOfficeTrustCardKey,
  type FrontOfficeTrustResponse,
} from "./front-office.types.js";

export type FrontOfficeTrustServiceDeps = {
  listGhlConnectionsPresentedImpl?: typeof listGhlConnectionsPresented;
  listCampaignRoutingRulesImpl?: typeof listCampaignRoutingRules;
  presentRoutingRulesWithReadinessEnrichedImpl?: typeof presentRoutingRulesWithReadinessEnriched;
  getAdminMetricsSummaryImpl?: typeof getAdminMetricsSummary;
  getAutomationSignalHealthImpl?: typeof getAutomationSignalHealth;
};

async function loadTrustSlices(
  clientAccountId: string | undefined,
  deps: FrontOfficeTrustServiceDeps
): Promise<TrustSliceData> {
  const listGhl = deps.listGhlConnectionsPresentedImpl ?? listGhlConnectionsPresented;
  const listRules = deps.listCampaignRoutingRulesImpl ?? listCampaignRoutingRules;
  const presentRules =
    deps.presentRoutingRulesWithReadinessEnrichedImpl ?? presentRoutingRulesWithReadinessEnriched;
  const getMetrics = deps.getAdminMetricsSummaryImpl ?? getAdminMetricsSummary;
  const getSignal = deps.getAutomationSignalHealthImpl ?? getAutomationSignalHealth;

  const { from, to } = resolveSummaryDateRange(undefined, undefined);
  const signalRange = resolveAutomationDashboardDateRange({ range: "7d" });

  const [ghlRows, ruleRows, metrics, signal] = await Promise.all([
    listGhl(clientAccountId ? { clientAccountId } : {}),
    listRules(clientAccountId ? { clientAccountId } : {}),
    getMetrics(from, to).catch(() => null),
    getSignal({
      clientAccountId,
      from: signalRange.from,
      to: signalRange.to,
    }).catch(() => null),
  ]);

  const ghlItems = ghlRows.map(presentGhlLocationConnectionForAdmin);
  const rules = await presentRules(ruleRows);

  return { ghlItems, rules, metrics, signal };
}

function resolveTrustDataSource(liveCount: number): FrontOfficeDataSource {
  if (liveCount === 0) return "mock";
  if (liveCount >= FRONT_OFFICE_TRUST_CARD_KEYS.length) return "live";
  return "partial_live";
}

export async function buildFrontOfficeTrustCenter(
  clientAccountId: string | undefined,
  deps: FrontOfficeTrustServiceDeps = {}
): Promise<Omit<FrontOfficeTrustResponse, "ok">> {
  const now = new Date().toISOString();
  let slices: TrustSliceData;
  try {
    slices = await loadTrustSlices(clientAccountId, deps);
  } catch {
    return {
      generatedAt: now,
      dataSource: "mock",
      cards: FRONT_OFFICE_TRUST_CARD_KEYS.map((key) => mockTrustCard(key, now)),
    };
  }

  let liveCount = 0;
  const cards = FRONT_OFFICE_TRUST_CARD_KEYS.map((key: FrontOfficeTrustCardKey) => {
    const live = TRUST_CARD_BUILDERS[key](slices, now);
    if (live) {
      liveCount += 1;
      return live;
    }
    return mockTrustCard(key, now);
  });

  return {
    generatedAt: now,
    dataSource: resolveTrustDataSource(liveCount),
    cards,
  };
}

export function summarizeTrust(cards: FrontOfficeTrustResponse["cards"]) {
  const cardsNeedingAttention = cards
    .filter((c) => c.status === "failed" || c.status === "warning" || c.status === "needs_setup")
    .map((c) => c.title);
  const warningCount = cards.reduce((sum, c) => sum + c.warnings.length, 0);
  const worst =
    cards.find((c) => c.status === "failed")?.status ??
    cards.find((c) => c.status === "warning")?.status ??
    cards.find((c) => c.status === "needs_setup")?.status ??
    "verified";
  return {
    status: worst,
    warningCount,
    cardsNeedingAttention,
  };
}
