import { AdminCocForbiddenError, requireAdminCocAdminSession } from "@/lib/admin-coc-session-guard";
import { fetchOnboardingSummary, listOnboardingTestRuns } from "@/lib/admin-api/client-onboarding-v2";
import {
  fetchCompanyGoogleConnection,
  fetchCompanySheetsDispatch,
} from "@/lib/admin-api/company-google-sheets";
import {
  fetchAdminClientDeliveryConfig,
  fetchAdminGhlConnections,
  isAdminApiConfigured,
} from "@/lib/admin-api/server";
import { SetupDeliveryWorkspace } from "@/components/clients/onboarding/setup-delivery-workspace";
import type { GhlWalkthroughConnection, GhlWalkthroughLocation } from "@/components/clients/onboarding/ghl-walkthrough-types";
import type { ClientDeliveryConfigResponse } from "@/lib/clients/delivery-config-types";
import type { CompanyConnectionIdentity } from "@/lib/clients/onboarding/types";
import type { GhlLocationConnectionItem } from "@/lib/ghl-connections/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Setup & Delivery" };

export default async function ClientOnboardingPage({
  params,
}: {
  params: Promise<{ clientAccountId: string }>;
}) {
  try {
    await requireAdminCocAdminSession();
  } catch (error) {
    if (error instanceof AdminCocForbiddenError) {
      return (
        <main className="grid min-h-[40vh] place-items-center p-6">
          <p className="text-sm text-slate-800">Observers and portal users cannot open Setup & Delivery.</p>
        </main>
      );
    }
    throw error;
  }

  const { clientAccountId } = await params;
  const id = decodeURIComponent(clientAccountId);

  if (!isAdminApiConfigured()) {
    return (
      <SetupDeliveryWorkspace
        clientAccountId={id}
        summary={null}
        summaryError="request_failed"
        connection={null}
        connectionError="request_failed"
        dispatch={null}
        dispatchError="request_failed"
        ghlLocation={null}
        ghlConnections={[]}
        ghlLocationError="GHL destination was not loaded."
      />
    );
  }

  const [summary, connection, dispatch, runs, delivery, ghlConnections] = await Promise.all([
    fetchOnboardingSummary(id),
    fetchCompanyGoogleConnection(),
    fetchCompanySheetsDispatch(id),
    listOnboardingTestRuns(id),
    fetchAdminClientDeliveryConfig(id),
    fetchAdminGhlConnections(),
  ]);

  return (
    <SetupDeliveryWorkspace
      clientAccountId={id}
      summary={summary.ok ? summary.data : null}
      summaryError={summary.ok ? null : summary.error}
      initialRuns={runs.ok ? runs.data : []}
      testRunListLoaded={runs.ok}
      connection={connection.ok ? projectConnection(connection.data.connection) : null}
      connectionError={connection.ok ? null : "request_failed"}
      dispatch={
        dispatch.ok
          ? {
              dispatchFlagEnabled: dispatch.data.dispatchFlagEnabled,
              campaignDispatchEnabled: dispatch.data.campaignDispatchEnabled,
              agedDispatchEnabled: dispatch.data.agedDispatchEnabled,
            }
          : null
      }
      dispatchError={dispatch.ok ? null : "request_failed"}
      ghlLocation={delivery.data ? projectGhlLocation(delivery.data) : null}
      ghlConnections={ghlConnections.data ? projectGhlConnections(ghlConnections.data.items) : []}
      ghlLocationError={delivery.error ? "GHL destination was not loaded." : null}
    />
  );
}

function projectConnection(connection: {
  status: string;
  connected: boolean;
  googleEmail: string | null;
  googleDisplayName: string | null;
  connectedAt: string | null;
  liveDeliveryEnabled: false;
}): CompanyConnectionIdentity {
  return {
    status: connection.status,
    connected: connection.connected,
    googleEmail: connection.googleEmail,
    googleDisplayName: connection.googleDisplayName,
    connectedAt: connection.connectedAt,
    liveDeliveryEnabled: false,
  };
}

function projectGhlLocation(config: ClientDeliveryConfigResponse): GhlWalkthroughLocation | null {
  const dest = config.ghlDestination;
  if (!dest && !config.locationId) return null;
  return {
    locationId: dest?.destinationSubaccountIdGhl ?? config.locationId,
    locationName: dest?.locationName ?? config.locationName,
    workflowId: dest?.destinationWorkflowIdGhl ?? null,
    workflowTriggerMode: dest?.workflowTriggerMode ?? null,
    deliveryEnabled: dest ? dest.deliveryEnabled : null,
    opportunityCreationEnabled: dest ? dest.opportunityCreationEnabled : null,
    pipelineId: dest?.destinationPipelineIdGhl ?? null,
    stageId: dest?.destinationPipelineStageIdGhl ?? null,
  };
}

function projectGhlConnections(items: GhlLocationConnectionItem[]): GhlWalkthroughConnection[] {
  return items.map((item) => ({
    id: item.id,
    locationId: item.locationId,
    locationName: item.locationName,
    clientAccountId: item.clientAccountId,
    connectionStatus: item.connectionStatus,
  }));
}
