import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // sw.js and the web manifest must stay outside the session check: the browser
  // fetches the service-worker script (and re-fetches it to check for updates)
  // outside the page's own request, so passing it through here served the login
  // page as the script and registration failed with a bad MIME type.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
