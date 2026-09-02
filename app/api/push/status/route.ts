import { NextResponse } from "next/server";

import { isPushConfigured } from "@/lib/notifications/push";

// Whether push notifications are switched on for this deployment — a plain
// boolean and nothing else, so it can be checked without signing in when the
// alerts menu entry does not appear. It never reveals a key: `configured` is
// true only when BOTH VAPID variables are present, and `publicKeyPresent` says
// which half is missing when it is not.
export async function GET() {
  return NextResponse.json({
    configured: isPushConfigured(),
    publicKeyPresent: Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
    privateKeyPresent: Boolean(process.env.VAPID_PRIVATE_KEY),
  });
}
