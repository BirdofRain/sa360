import { randomUUID } from "node:crypto";
import { AgentWorkspaceActionStatus, type Prisma } from "@prisma/client";
import { redactWebhookPayloadForLog } from "@sa360/shared";
import { prisma } from "../lib/db.js";
import { enrichLifecyclePayloadForIngest } from "../lib/lifecycle-event-enrich.js";
import { runActionCenterGhlWriteback } from "../lib/action-dashboard-ghl-writeback.js";
import type { ActionDashboardActionBody } from "../schemas/action-dashboard-action.schema.js";
import { saveLifecycleEvent } from "./event-service.js";
import { upsertFromLifecyclePayload } from "./inbound-contact-index.service.js";
import { findByContactIdGhl } from "../repositories/inbound-contact-index.repository.js";
import {
  buildLifecyclePayloadsForAction,
  listEventNamesForActionCode,
  resolvePhoneE164,
} from "./action-dashboard-action-map.js";

export type ActionDashboardActionResult = {
  ok: true;
  actionId: string;
  eventsCreated: Array<{ eventUuid: string; eventNameInternal: string }>;
  indexUpdated: boolean;
  ghlWriteback: {
    attempted: boolean;
    status: string;
    message?: string;
  };
};

export type ActionDashboardActionFailure = {
  ok: false;
  error: string;
  details?: unknown;
};

export async function executeActionDashboardAction(
  body: ActionDashboardActionBody
): Promise<ActionDashboardActionResult | ActionDashboardActionFailure> {
  const contactId = body.contactIdGhl.trim();
  const subaccountIdGhl = body.locationId?.trim() ?? "";

  const indexRow = await findByContactIdGhl(contactId, {
    clientAccountId: body.clientAccountId,
    subaccountIdGhl: subaccountIdGhl || undefined,
  });

  const phoneE164 = resolvePhoneE164(body, indexRow?.phoneE164);
  if (!phoneE164) {
    return {
      ok: false,
      error:
        "phoneE164 is required (provide in request or ensure InboundContactIndex has a phone)",
    };
  }

  const action = await prisma.agentWorkspaceAction.create({
    data: {
      clientAccountId: body.clientAccountId,
      subaccountIdGhl: subaccountIdGhl || null,
      contactIdGhl: contactId,
      leadUid: body.leadUid?.trim() || indexRow?.leadUid || null,
      actionType: "action_center_what_happened",
      status: AgentWorkspaceActionStatus.PENDING,
      payloadJson: redactWebhookPayloadForLog({
        actionCode: body.actionCode,
        notes: body.notes,
        followUpDueAt: body.followUpDueAt,
        appointmentStartAt: body.appointmentStartAt,
        policy: body.policy,
        call: body.call,
        actor: body.actor,
        expectedEvents: listEventNamesForActionCode(body.actionCode),
      }) as Prisma.InputJsonValue,
      responseJson: { source: "action_center" } as Prisma.InputJsonValue,
    },
  });

  const payloads = buildLifecyclePayloadsForAction({
    body,
    actionId: action.id,
    indexRow,
  });

  const eventsCreated: Array<{ eventUuid: string; eventNameInternal: string }> = [];
  let lastEnriched = payloads[payloads.length - 1];

  for (const p of payloads) {
    const raw = {
      ...p,
      event: {
        ...p.event,
        event_uuid: randomUUID(),
      },
    };
    const enriched = enrichLifecyclePayloadForIngest({
      ...raw,
      attribution: {},
    });
    await saveLifecycleEvent(enriched);
    eventsCreated.push({
      eventUuid: enriched.event.event_uuid,
      eventNameInternal: enriched.event.event_name_internal,
    });
    lastEnriched = enriched;
  }

  let indexUpdated = false;
  try {
    indexUpdated = await upsertFromLifecyclePayload(lastEnriched, {
      eventUuid: eventsCreated[eventsCreated.length - 1]?.eventUuid,
    });
  } catch {
    indexUpdated = false;
  }

  const ghlWriteback = await runActionCenterGhlWriteback({
    body,
    actionId: action.id,
    lifecycleEventUuids: eventsCreated.map((e) => e.eventUuid),
  });

  await prisma.agentWorkspaceAction.update({
    where: { id: action.id },
    data: {
      status: AgentWorkspaceActionStatus.SYNCED,
      responseJson: {
        source: "action_center",
        eventsCreated,
        indexUpdated,
        ghlWriteback,
      } as Prisma.InputJsonValue,
    },
  });

  return {
    ok: true,
    actionId: action.id,
    eventsCreated,
    indexUpdated,
    ghlWriteback: {
      attempted: ghlWriteback.attempted,
      status: ghlWriteback.status,
      message: ghlWriteback.message,
    },
  };
}
