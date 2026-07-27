import { NextResponse } from "next/server";

import { ADMIN_KEY_HEADER, getAdminApiBaseUrl, getAdminApiKey } from "@/lib/admin-api/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ exportId: string }> }
) {
  const { exportId } = await context.params;
  const baseUrl = getAdminApiBaseUrl();
  const apiKey = getAdminApiKey();
  if (!baseUrl || !apiKey) {
    return NextResponse.json({ ok: false, error: "admin_api_not_configured" }, { status: 502 });
  }

  const url = `${baseUrl}/admin/v1/fulfillment-ops/exports/${encodeURIComponent(exportId)}/download`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      [ADMIN_KEY_HEADER]: apiKey,
      Accept: "text/csv,application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    let details: unknown = text;
    try {
      details = JSON.parse(text);
    } catch {
      /* keep text */
    }
    return NextResponse.json(
      { ok: false, error: "export_download_failed", details },
      { status: res.status || 502 }
    );
  }

  const csv = await res.text();
  const contentType = res.headers.get("content-type") ?? "text/csv; charset=utf-8";
  const disposition =
    res.headers.get("content-disposition") ??
    `attachment; filename="sa360-delivery_${exportId}.csv"`;
  const sha = res.headers.get("x-sa360-content-sha256");

  const headers: Record<string, string> = {
    "content-type": contentType,
    "content-disposition": disposition,
  };
  if (sha) headers["x-sa360-content-sha256"] = sha;
  return new NextResponse(csv, { status: 200, headers });
}
