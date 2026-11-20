/**
 * Campaign-specific GHL execution gate.
 *
 * Only trim() equal to the exact string "true" opens this gate.
 * Unset, blank, TRUE, 1, yes, and on stay off.
 *
 * Off means campaign planning does not read a shadow row, does not select a
 * workflow, and does not add campaign tags. The existing client GHL dispatch
 * path does not consult this flag.
 *
 * On does not authorize a live send, a tag post, or a workflow start.
 * Live campaign execution stays unauthorized until a later phase wires a
 * durable grant and the existing canary gates on purpose.
 */
export function isClientCampaignGhlExecutionEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.SA360_CLIENT_CAMPAIGN_GHL_EXECUTION_ENABLED?.trim() === "true";
}
