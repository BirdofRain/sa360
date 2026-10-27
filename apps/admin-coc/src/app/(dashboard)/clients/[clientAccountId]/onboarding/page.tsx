import { AdminCocForbiddenError, requireAdminCocAdminSession } from "@/lib/admin-coc-session-guard";
import { fetchOnboardingSummary } from "@/lib/admin-api/client-onboarding-v2";
import {
  fetchCompanyGoogleConnection,
  fetchCompanySheetsDispatch,
} from "@/lib/admin-api/company-google-sheets";
import { isAdminApiConfigured } from "@/lib/admin-api/server";
import { SetupDeliveryWorkspace } from "@/components/clients/onboarding/setup-delivery-workspace";
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

  const [summary, connection, dispatch] = await Promise.all([
    fetchOnboardingSummary(id),
    fetchCompanyGoogleConnection(),
    fetchCompanySheetsDispatch(id),
  ]);

  return (
    <SetupDeliveryWorkspace
      clientAccountId={id}
      summary={summary.ok ? summary.data : null}
      summaryError={summary.ok ? null : summary.error}
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
