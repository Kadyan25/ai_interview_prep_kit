import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "prep_token";

/**
 * A convenience redirect only. The API verifies the token on every request and
 * is the real gate; this just avoids rendering an app shell for signed-out users.
 */
export function middleware(request: NextRequest) {
  const hasToken = request.cookies.has(COOKIE);
  const { pathname } = request.nextUrl;

  if (!hasToken && pathname.startsWith("/kits")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (hasToken && (pathname === "/login" || pathname === "/register")) {
    const url = request.nextUrl.clone();
    url.pathname = "/kits";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/kits/:path*", "/login", "/register"],
};
