/**
 * Campaign manager gates.
 *
 * The interface flag only decides whether Team Workspace renders the section.
 * It does not enable the API registry. `SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED`
 * is a separate exact-true server flag and stays off unless this process is an
 * isolated local or test run. `TRUE`, `1`, `yes`, and `on` stay off.
 * Neither flag routes a lead, confirms a source, or arms delivery.
 */

export type ClientCampaignManagerEnv = {
  NEXT_PUBLIC_SA360_CLIENT_CAMPAIGN_MANAGER_ENABLED?: string;
  NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED?: string;
  SA360_TEAM_WORKSPACE_ENABLED?: string;
  SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED?: string;
};

export function isClientCampaignManagerEnabled(env?: ClientCampaignManagerEnv): boolean {
  const value =
    env === undefined
      ? process.env.NEXT_PUBLIC_SA360_CLIENT_CAMPAIGN_MANAGER_ENABLED
      : env.NEXT_PUBLIC_SA360_CLIENT_CAMPAIGN_MANAGER_ENABLED;
  return value?.trim() === "true";
}

export function isClientCampaignRegistryServerEnabled(env?: ClientCampaignManagerEnv): boolean {
  const value =
    env === undefined
      ? process.env.SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED
      : env.SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED;
  return value?.trim() === "true";
}

export type ClientCampaignManagerBlock =
  | "manager_ui"
  | "team_workspace"
  | "team_workspace_server"
  | "registry";

export function clientCampaignManagerBlock(env?: ClientCampaignManagerEnv): ClientCampaignManagerBlock | null {
  const source = env ?? process.env;
  if (source.NEXT_PUBLIC_SA360_CLIENT_CAMPAIGN_MANAGER_ENABLED?.trim() !== "true") return "manager_ui";
  if (source.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED?.trim() !== "true") return "team_workspace";
  if (source.SA360_TEAM_WORKSPACE_ENABLED?.trim() !== "true") return "team_workspace_server";
  if (source.SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED?.trim() !== "true") return "registry";
  return null;
}
