import Link from "next/link";

import {
  loadDeliveryNotificationRecipient,
  saveDeliveryNotificationRecipientAction,
} from "@/app/actions/delivery-notification-recipient";
import { NotificationRecipientForm } from "@/components/clients/notification-recipient-form";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { fetchAdminClientDetail, isAdminApiConfigured } from "@/lib/admin-api/server";
import { AdminCocForbiddenError, requireAdminCocAdminSession } from "@/lib/admin-coc-session-guard";
import { notificationErrorMessage } from "@/lib/notification-setup/model";
import { normalizeTeamWorkspaceClientId } from "@/lib/team-workspace/contract";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notification recipient" };

export default async function NotificationRecipientPage({
  params,
}: {
  params: Promise<{ clientAccountId: string }>;
}) {
  const { clientAccountId } = await params;
  const id = normalizeTeamWorkspaceClientId(clientAccountId);
  if (!id) {
    return (
      <RecipientMessage
        title="That client id is not valid"
        body="Open the client from Clients and subaccounts. Nothing was loaded for this address."
      />
    );
  }

  try {
    await requireAdminCocAdminSession();
    if (!isAdminApiConfigured()) {
      return (
        <RecipientMessage
          title="Admin API is not configured"
          body="Set the admin API address and key for this app. Nothing was loaded."
          clientAccountId={id}
        />
      );
    }

    const [recipient, detail] = await Promise.all([
      loadDeliveryNotificationRecipient(id),
      fetchAdminClientDetail(id),
    ]);
    const clientDisplayName = detail.data?.item?.clientDisplayName ?? id;

    if (!recipient.ok) {
      return (
        <RecipientMessage
          title={recipient.error === "team_workspace_disabled" ? "Notification setup is turned off" : "Recipient could not be loaded"}
          body={notificationErrorMessage(recipient.error)}
          clientAccountId={id}
          retryHref={`/clients/${encodeURIComponent(id)}/notification-recipient`}
        />
      );
    }

    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <Link href={`/clients/${encodeURIComponent(id)}`} className="text-xs text-sky-700 hover:underline">
            ← {clientDisplayName}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Delivery notification recipient</h1>
          <p className="mt-1 text-sm text-slate-600">
            One verified email for {clientDisplayName}. Team Workspace can turn notification on or off after this
            address is saved. This page does not send email.
          </p>
          <p className="font-mono text-xs text-slate-500">{id}</p>
        </div>
        <NotificationRecipientForm
          clientAccountId={id}
          recipient={recipient.recipient}
          actions={{
            save: saveDeliveryNotificationRecipientAction,
            reload: loadDeliveryNotificationRecipient,
          }}
        />
      </div>
    );
  } catch (error) {
    if (error instanceof AdminCocForbiddenError) {
      return (
        <RecipientMessage
          title="Admin session required"
          body="Observers and portal sessions cannot configure a notification recipient."
        />
      );
    }
    throw error;
  }
}

function RecipientMessage({
  title,
  body,
  clientAccountId,
  retryHref,
}: {
  title: string;
  body: string;
  clientAccountId?: string;
  retryHref?: string;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <WarningBanner tone="warn" title={title}>
        {body}
        {retryHref ? (
          <>
            {" "}
            <a href={retryHref} className="font-medium underline">
              Try again
            </a>
          </>
        ) : null}
      </WarningBanner>
      {clientAccountId ? (
        <Link href={`/clients/${encodeURIComponent(clientAccountId)}`} className="text-sm text-sky-700 hover:underline">
          Back to client profile
        </Link>
      ) : (
        <Link href="/clients" className="text-sm text-sky-700 hover:underline">
          Back to clients
        </Link>
      )}
    </div>
  );
}
