import "server-only";

import { getPipelineStudioFixture } from "./fixtures";
import type { PipelineStudioReadModel } from "./types";

/**
 * Future: replace fixture load with one authenticated read API call.
 * Must remain a presentation adapter — no inventory/routing business logic.
 */
export async function getPipelineStudioReadModel(): Promise<PipelineStudioReadModel> {
  return getPipelineStudioFixture();
}
