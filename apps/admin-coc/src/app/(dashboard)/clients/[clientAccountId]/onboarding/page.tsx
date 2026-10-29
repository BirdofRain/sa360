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
      />
    );
  }

  const [summary, connection, dispatch, runs, deliveryConfig, ghlConnections] = await Promise.all([
    fetchOnboardingSummary(id),
    fetchCompanyGoogleConnection(),
    fetchCompanySheetsDispatch(id),
    listOnboardingTestRuns(id),
    fetchAdminClientDeliveryConfig(id),
    fetchAdminGhlConnections(id),
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
      ghlLocation={deliveryConfig.data ? projectGhlLocation(deliveryConfig.data) : null}
      ghlConnections={ghlConnections.data ? projectGhlConnections(ghlConnections.data.items) : []}
      ghlLocationError={deliveryConfig.error ?? ghlConnections.error}
    />
  );
}

function projectGhlLocation(config: ClientDeliveryConfigResponse): GhlWalkthroughLocation {
  const destination = config.ghlDestination;
  return {
    locationId: config.locationId,
    locationName: config.locationName,
    workflowId: destination?.destinationWorkflowIdGhl ?? null,
    workflowTriggerMode: destination?.workflowTriggerMode ?? null,
    deliveryEnabled: destination?.deliveryEnabled ?? null,
    opportunityCreationEnabled: destination?.opportunityCreationEnabled ?? null,
    pipelineId: destination?.destinationPipelineIdGhl ?? null,
    stageId: destination?.destinationPipelineStageIdGhl ?? null,
    sourceAttributeFieldMapJson: destination?.sourceAttributeFieldMapJson ?? null,
  };
}

function projectGhlConnections(
  items: Array<{
    id: string;
    locationId: string;
    locationName: string | null;
    clientAccountId: string | null;
    connectionStatus: string;
  }>
): GhlWalkthroughConnection[] {
  return items.map((item) => ({
    id: item.id,
    locationId: item.locationId,
    locationName: item.locationName,
    clientAccountId: item.clientAccountId,
    connectionStatus: item.connectionStatus,
  }));
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
