import {
  createGhlAdapterRunWithSteps,
  findGhlAdapterRunById,
  listGhlAdapterRuns,
  simulationToRunCreateInput,
} from "../repositories/ghl-delivery-adapter-run.repository.js";
import { buildAdapterSimulation } from "../services/ghl-delivery-adapter/ghl-delivery-adapter.service.js";
import {
  GHL_ADAPTER_SAFETY_MESSAGE,
  presentGhlAdapterRun,
} from "../services/ghl-delivery-adapter/ghl-delivery-adapter.present.js";
import { getGhlDeliveryAdapterMode } from "../lib/ghl-delivery-adapter-mode.js";
import { warmEffectiveDeliveryAdapterMode } from "./delivery-runtime-mode.service.js";

export async function runGhlAdapterSimulationForPlan(
  planId: string,
  opts: { checkLiveReadiness?: boolean } = {}
) {
  await warmEffectiveDeliveryAdapterMode();
  const startedAt = new Date();
  const built = await buildAdapterSimulation(planId, opts);
  if ("notFound" in built) return { notFound: true as const };

  const completedAt = new Date();
  const run = await createGhlAdapterRunWithSteps(
    simulationToRunCreateInput(built.context.plan, built.simulation, startedAt, completedAt)
  );

  return {
    ok: built.simulation.mode !== "disabled",
    adapterRun: presentGhlAdapterRun(run),
    validation: built.simulation.validation,
    safetyMessage: GHL_ADAPTER_SAFETY_MESSAGE,
    adapterMode: getGhlDeliveryAdapterMode(),
    blockedReason:
      built.simulation.mode === "disabled"
        ? "Effective adapter mode is disabled — check env max and runtime delivery mode."
        : null,
  };
}

export async function getGhlAdapterRunDetail(id: string) {
  const run = await findGhlAdapterRunById(id);
  if (!run) return { notFound: true as const };
  return { adapterRun: presentGhlAdapterRun(run) };
}

export async function listGhlAdapterRunsPresented(
  opts: Parameters<typeof listGhlAdapterRuns>[0]
) {
  const rows = await listGhlAdapterRuns(opts);
  return rows.map(presentGhlAdapterRun);
}
