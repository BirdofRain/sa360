import {
  COMPANY_SHEETS_TAB_ROLES,
  companySheetsDeliveryState,
  companySheetsTabUrl,
  type CompanySheetsPortalDeliveryState,
  type CompanySheetsTabRole,
} from "./company-google-sheets-env.js";

export type CompanySheetsStoredTab = {
  role: string;
  setupState: string;
  setupReason: string | null;
  worksheetId: number | null;
  worksheetTitle: string | null;
  schemaVersion: string | null;
};

export type CompanySheetsJobState = {
  kind: string;
  status: string;
  rowsWritten: number;
  rowsTotal: number;
};

export type CompanySheetsTabView = {
  role: CompanySheetsTabRole;
  setupState: "missing" | "incompatible" | "bound";
  setupReason: string | null;
  worksheetId: number | null;
  worksheetTitle: string | null;
  schemaVersion: string | null;
  tabUrl: string | null;
  deliveryState: CompanySheetsPortalDeliveryState;
};

const KIND_FOR_ROLE: Record<CompanySheetsTabRole, string | null> = {
  campaign: "lead",
  aged: "aged_release",
  canary: "canary",
};

function setupStateOf(value: string | undefined): CompanySheetsTabView["setupState"] {
  if (value === "bound" || value === "incompatible") return value;
  return "missing";
}

export function presentCompanySheetsTabs(input: {
  spreadsheetId: string;
  spreadsheetUrl: string;
  contracts: readonly CompanySheetsStoredTab[];
  jobs: readonly CompanySheetsJobState[];
  roles?: readonly CompanySheetsTabRole[];
}): CompanySheetsTabView[] {
  const roles = input.roles ?? COMPANY_SHEETS_TAB_ROLES;
  return roles.map((role) => {
    const stored = input.contracts.find((row) => row.role === role);
    const bound = stored?.setupState === "bound" && stored.worksheetId != null;
    const kind = KIND_FOR_ROLE[role];
    const jobs = kind ? input.jobs.filter((job) => job.kind === kind) : [];
    return {
      role,
      setupState: setupStateOf(stored?.setupState),
      setupReason: stored?.setupReason ?? (stored ? null : "tab_missing"),
      worksheetId: stored?.worksheetId ?? null,
      worksheetTitle: stored?.worksheetTitle ?? null,
      schemaVersion: stored?.schemaVersion ?? null,
      tabUrl: bound
        ? companySheetsTabUrl(input.spreadsheetUrl, input.spreadsheetId, stored.worksheetId as number)
        : null,
      deliveryState: companySheetsDeliveryState(jobs),
    };
  });
}
