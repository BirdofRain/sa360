import type { PrismaClient } from "@prisma/client";

import { CSV_CONTENT_TYPE } from "../../lib/csv-content-disposition.js";
import { prisma } from "../../lib/db.js";
import {
  findReleasedLeadDeliveryExportPackageForClient,
  listReleasedLeadDeliveryExportPackagesForOrder,
} from "../../repositories/lead-delivery-export-package.repository.js";
import {
  presentClientReleasedDelivery,
  type ClientReleasedDelivery,
} from "./lead-order-delivery.present.js";
import { getLeadOrderForAudience, type LeadOrderServiceDeps } from "./lead-order.service.js";

export type LeadOrderReleasedDeliveriesServiceDeps = LeadOrderServiceDeps & {
  db?: PrismaClient;
  listReleasedLeadDeliveryExportPackagesForOrderImpl?: typeof listReleasedLeadDeliveryExportPackagesForOrder;
  findReleasedLeadDeliveryExportPackageForClientImpl?: typeof findReleasedLeadDeliveryExportPackageForClient;
};

export type ClientReleasedDeliveryDownload = {
  item: ClientReleasedDelivery;
  filename: string;
  contentType: typeof CSV_CONTENT_TYPE;
  csv: string;
};

export async function listClientReleasedDeliveries(
  input: { orderId: string; clientAccountId: string },
  deps: LeadOrderReleasedDeliveriesServiceDeps = {}
): Promise<{ items: ClientReleasedDelivery[] } | null> {
  const order = await getLeadOrderForAudience(input.orderId, input.clientAccountId, deps);
  if (!order) return null;

  const list =
    deps.listReleasedLeadDeliveryExportPackagesForOrderImpl ??
    listReleasedLeadDeliveryExportPackagesForOrder;
  const db = deps.db ?? prisma;
  const rows = await list(
    { leadOrderId: order.id, clientAccountId: input.clientAccountId },
    db
  );
  return { items: rows.map(presentClientReleasedDelivery) };
}

export async function getClientReleasedDelivery(
  input: { orderId: string; exportId: string; clientAccountId: string },
  deps: LeadOrderReleasedDeliveriesServiceDeps = {}
): Promise<ClientReleasedDelivery | null> {
  const downloaded = await getClientReleasedDeliveryDownload(input, deps);
  return downloaded?.item ?? null;
}

export async function getClientReleasedDeliveryDownload(
  input: { orderId: string; exportId: string; clientAccountId: string },
  deps: LeadOrderReleasedDeliveriesServiceDeps = {}
): Promise<ClientReleasedDeliveryDownload | null> {
  const order = await getLeadOrderForAudience(input.orderId, input.clientAccountId, deps);
  if (!order) return null;

  const find =
    deps.findReleasedLeadDeliveryExportPackageForClientImpl ??
    findReleasedLeadDeliveryExportPackageForClient;
  const db = deps.db ?? prisma;
  const row = await find(
    {
      exportId: input.exportId,
      leadOrderId: order.id,
      clientAccountId: input.clientAccountId,
    },
    db
  );
  if (!row) return null;

  const item = presentClientReleasedDelivery(row);
  return {
    item,
    filename: item.filename,
    contentType: CSV_CONTENT_TYPE,
    csv: row.csvContent,
  };
}
