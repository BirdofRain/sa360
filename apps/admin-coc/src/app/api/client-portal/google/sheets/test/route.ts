import { testGoogleSheetFromPortal } from "@/lib/client-portal-api/google-sheets";
import {
  clientAccountIdRejectedResponse,
  readJsonBody,
  sheetsBffErrorResponse,
} from "@/lib/client-portal-api/google-sheets-bff";
import { readPortalSheetsSession } from "@/lib/client-portal-api/google-sheets-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await readPortalSheetsSession();
  if (!session) {
    return Response.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  const body = await readJsonBody(request);
  const rejected = clientAccountIdRejectedResponse(body);
  if (rejected) return rejected;
  const spreadsheetId = typeof body.spreadsheetId === "string" ? body.spreadsheetId : "";
  const worksheetId = typeof body.worksheetId === "number" ? body.worksheetId : Number.NaN;
  const result = await testGoogleSheetFromPortal(session, { spreadsheetId, worksheetId });
  if (!result.ok) return sheetsBffErrorResponse(result);
  return Response.json(result.data);
}
