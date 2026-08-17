import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/types/database.types";

const PUBLIC_PATHS = ["/login", "/reset-password", "/auth/callback"];

// App-level session timeouts (the native Supabase controls are a Pro-plan
// feature). Two tracking cookies bound the session:
//   - erp_sess_seen  — sliding: refreshed on every request; > 8h idle expires.
//   - erp_sess_start — fixed at first request of a session; > 24h expires.
const SESS_START = "erp_sess_start";
const SESS_SEEN = "erp_sess_seen";
const INACTIVITY_MS = 8 * 60 * 60 * 1000; // 8 hours idle
const MAX_SESSION_MS = 24 * 60 * 60 * 1000; // 24 hours absolute
const TRACK_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // cookie lifetime; the caps above govern

function stampSession(response: NextResponse, start: number, seen: number) {
  const options = {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: TRACK_COOKIE_MAX_AGE,
  };
  response.cookies.set(SESS_START, String(start), options);
  response.cookies.set(SESS_SEEN, String(seen), options);
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Verify the session from the JWT locally (cached signing keys) instead of a
  // network round-trip to the Auth server on every request — this middleware
  // runs on every navigation, so getUser() here was the main source of app-wide
  // latency. Requires asymmetric JWT signing keys enabled on the project;
  // otherwise getClaims transparently falls back to a server call.
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims ?? null;

  const isPublicPath = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  // Enforce the inactivity + absolute session caps. On timeout, clear both the
  // Supabase auth cookies and our trackers, and send the user back to /login.
  const now = Date.now();
  let sessStart = 0;
  let sessSeen = 0;
  if (user) {
    sessStart = Number(request.cookies.get(SESS_START)?.value) || 0;
    sessSeen = Number(request.cookies.get(SESS_SEEN)?.value) || 0;
    const timedOut =
      (sessStart > 0 && now - sessStart > MAX_SESSION_MS) ||
      (sessSeen > 0 && now - sessSeen > INACTIVITY_MS);
    if (timedOut) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", request.nextUrl.pathname);
      url.searchParams.set("reason", "timeout");
      const timeoutResponse = NextResponse.redirect(url);
      for (const cookie of request.cookies.getAll()) {
        if (cookie.name.startsWith("sb-")) timeoutResponse.cookies.delete(cookie.name);
      }
      timeoutResponse.cookies.delete(SESS_START);
      timeoutResponse.cookies.delete(SESS_SEEN);
      return timeoutResponse;
    }
  }

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  if (user && request.nextUrl.pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    const dashboardResponse = NextResponse.redirect(url);
    stampSession(dashboardResponse, sessStart || now, now);
    return dashboardResponse;
  }

  // Slide the inactivity window forward and anchor the session start once.
  if (user) stampSession(response, sessStart || now, now);

  return response;
}
