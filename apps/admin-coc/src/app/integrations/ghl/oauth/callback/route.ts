import { NextResponse, type NextRequest } from "next/server";

/** Legacy path on admin-coc host → canonical `/integrations/oauth/callback`. */
export function GET(request: NextRequest) {
  const url = new URL("/integrations/oauth/callback", request.url);
  url.search = request.nextUrl.search;
  return NextResponse.redirect(url);
}
