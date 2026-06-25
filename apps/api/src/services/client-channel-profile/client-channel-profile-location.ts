import { findClientAccountById } from "../../repositories/client-account.repository.js";
import { listGhlLocationConnections } from "../../repositories/ghl-location-connection.repository.js";

/**
 * Resolve the GHL location/subaccount for a client's channel profile:
 * explicit subaccount → client's saved GHL destination → first linked OAuth connection.
 * Never throws; returns null when nothing is resolvable.
 */
export async function resolveClientChannelLocationId(
  clientAccountId: string,
  subaccountIdGhl?: string | null
): Promise<string | null> {
  const sub = subaccountIdGhl?.trim();
  if (sub) return sub;
  try {
    const client = await findClientAccountById(clientAccountId.trim());
    const destSub = client?.ghlDestination?.destinationSubaccountIdGhl?.trim();
    if (destSub) return destSub;
    const connections = await listGhlLocationConnections({
      clientAccountId: clientAccountId.trim(),
      limit: 5,
    });
    return connections.find((c) => c.locationId)?.locationId ?? null;
  } catch {
    return null;
  }
}
