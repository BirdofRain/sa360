import {
  deleteGoogleSheetDestinationFromPortal,
  getGoogleSheetDestinationFromPortal,
  saveGoogleSheetDestinationFromPortal,
} from "@/lib/client-portal-api/google-sheets";
import {
  clientAccountIdRejectedResponse,
  readJsonBody,
  sheetsBffErrorResponse,
} from "@/lib/client-portal-api/google-sheets-bff";
import { readPortalSheetsSession } from "@/lib/client-portal-api/google-sheets-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await readPortalSheetsSession();
  if (!session) {
    return Response.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  const rejected = clientAccountIdRejectedResponse(new URL(request.url).searchParams);
  if (rejected) return rejected;
  const result = await getGoogleSheetDestinationFromPortal(session);
  if (!result.ok) return sheetsBffErrorResponse(result);
  return Response.json(result.data);
}

export async function PUT(request: Request) {
  const session = await readPortalSheetsSession();
  if (!session) {
    return Response.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  const body = await readJsonBody(request);
  const rejected = clientAccountIdRejectedResponse(body);
  if (rejected) return rejected;
  const spreadsheetId = typeof body.spreadsheetId === "string" ? body.spreadsheetId : "";
  const worksheetId = typeof body.worksheetId === "number" ? body.worksheetId : Number.NaN;
  const result = await saveGoogleSheetDestinationFromPortal(session, {
    spreadsheetId,
    worksheetId,
  });
  if (!result.ok) return sheetsBffErrorResponse(result);
  return Response.json(result.data);
}

export async function DELETE(request: Request) {
  const session = await readPortalSheetsSession();
  if (!session) {
    return Response.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  const rejectedQuery = clientAccountIdRejectedResponse(new URL(request.url).searchParams);
  if (rejectedQuery) return rejectedQuery;
  const body = await readJsonBody(request);
  const rejectedBody = clientAccountIdRejectedResponse(body);
  if (rejectedBody) return rejectedBody;
  const result = await deleteGoogleSheetDestinationFromPortal(session);
  if (!result.ok) return sheetsBffErrorResponse(result);
  return Response.json(result.data);
}
