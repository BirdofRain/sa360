export type MetaReviewTrace = {
  method: "GET" | "POST";
  endpoint: string;
  httpStatus: number;
  ok: boolean;
  timestamp: string;
  error: {
    code: string | null;
    subcode: string | null;
    type: string | null;
    message: string;
  } | null;
};

export type MetaReviewPreflight = {
  enabled: boolean;
  writesEnabled: boolean;
  graphApiVersion: string;
  tokens: {
    userOrSystemUser: { configured: boolean; masked: string };
    page: { configured: boolean; masked: string; boundPageId: string | null };
  };
  allowlists: { pageIds: string[]; adAccountIds: string[] };
  callback: { configured: boolean; routes: string[] };
  productionSafety: {
    intakeEnabled: boolean;
    graphFetchEnabled: boolean;
    routingEnabled: boolean;
    legacyDirectIntakeEnabled: boolean;
    safeForReview: boolean;
  };
  requiredTokens: Record<string, string>;
};

export type MetaReviewPage = {
  id: string;
  name: string | null;
  tasks: string[];
};

export type MetaReviewPermission = {
  permission: string;
  status: string | null;
};

export type MetaReviewSubscription = {
  id: string | null;
  name: string | null;
  subscribedFields: string[];
};

export type MetaReviewPost = {
  id: string | null;
  message: string | null;
  createdTime: string | null;
  permalinkUrl: string | null;
};

export type MetaReviewInsight = {
  campaignId: string | null;
  campaignName: string | null;
  impressions: string | null;
  spend: string | null;
  dateStart: string | null;
  dateStop: string | null;
};

export type MetaReviewActionResult<T> =
  | { ok: true; data: T; trace: MetaReviewTrace | null }
  | { ok: false; error: string; trace: MetaReviewTrace | null };
