import type { ActionDashboardActionBody } from "../schemas/action-dashboard-action.schema.js";

export type ActionCenterGhlWritebackStatus =
  | "disabled"
  | "not_configured"
  | "skipped"
  | "success"
  | "failed";

export type ActionCenterGhlWritebackResult = {
  attempted: boolean;
  status: ActionCenterGhlWritebackStatus;
  message?: string;
};

export type ActionCenterGhlWritebackInput = {
  body: ActionDashboardActionBody;
  actionId: string;
  lifecycleEventUuids: string[];
};

/** When true, action-center may call GHL APIs (not implemented in v1). */
export function isActionCenterGhlWritebackEnabled(): boolean {
  const raw = process.env.GHL_WRITEBACK_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/**
 * GHL writeback adapter — disabled by default (`GHL_WRITEBACK_ENABLED=false`).
 * Future: custom fields, tags, opportunity stage, notes, workflow triggers.
 */
export interface ActionCenterGhlWritebackAdapter {
  writeback(input: ActionCenterGhlWritebackInput): Promise<ActionCenterGhlWritebackResult>;
}

export class DisabledActionCenterGhlWritebackAdapter implements ActionCenterGhlWritebackAdapter {
  async writeback(): Promise<ActionCenterGhlWritebackResult> {
    if (!isActionCenterGhlWritebackEnabled()) {
      return {
        attempted: false,
        status: "disabled",
        message: "GHL_WRITEBACK_ENABLED is false",
      };
    }
    return {
      attempted: false,
      status: "not_configured",
      message: "GHL writeback adapter not implemented yet",
    };
  }
}

export const actionCenterGhlWritebackAdapter: ActionCenterGhlWritebackAdapter =
  new DisabledActionCenterGhlWritebackAdapter();

export async function runActionCenterGhlWriteback(
  input: ActionCenterGhlWritebackInput
): Promise<ActionCenterGhlWritebackResult> {
  return actionCenterGhlWritebackAdapter.writeback(input);
}
