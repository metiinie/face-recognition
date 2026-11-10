import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Protected administrative and HR routes
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/employees",
  "/reports",
  "/schedules",
  "/audit",
  "/biometrics",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (isProtected) {
    const token = request.cookies.get("eipc_jwt_token")?.value;

    if (!token) {
      const destination = pathname + request.nextUrl.search;
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect", destination);
      return NextResponse.redirect(loginUrl);
    }
  }

  // If already authenticated and navigating to login without explicit session-expired flag,
  // redirect smoothly to the target destination or dashboard
  if (pathname === "/login") {
    const token = request.cookies.get("eipc_jwt_token")?.value;
    const isExpired = request.nextUrl.searchParams.get("expired") === "1";
    if (token && !isExpired) {
      const rawRedirect = request.nextUrl.searchParams.get("redirect") || "/dashboard";
      const target = rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") ? rawRedirect : "/dashboard";
      return NextResponse.redirect(new URL(target, request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/employees/:path*",
    "/reports/:path*",
    "/schedules/:path*",
    "/audit/:path*",
    "/biometrics/:path*",
    "/login",
  ],
};

