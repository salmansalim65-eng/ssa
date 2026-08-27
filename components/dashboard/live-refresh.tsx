"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Keeps the dashboard's server-rendered figures live. It re-fetches:
//   - once when the dashboard is opened (so navigating in from a just-saved
//     entry always shows the latest numbers, not a cached render), and
//   - whenever the tab/window regains focus (so coming back after making an
//     entry elsewhere refreshes it too).
// router.refresh() only re-runs the server render; it keeps client state and
// does not remount this component, so there is no refresh loop.
export function DashboardLiveRefresh() {
  const router = useRouter();
  const didInitialRefresh = useRef(false);

  useEffect(() => {
    // Pull fresh data on open. Guarded so React's double-invoke in dev (and any
    // re-run of this effect) can't fire it twice.
    if (!didInitialRefresh.current) {
      didInitialRefresh.current = true;
      router.refresh();
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}
