"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Refreshes the dashboard's figures when the tab/window regains focus — e.g.
// after switching away to make an entry and coming back. It does NOT refresh on
// open (that would re-run all the dashboard queries on every visit and make it
// slow); a fresh render on navigation is handled server-side, and every posted
// entry busts the dashboard cache. router.refresh() only re-runs the server
// render, keeping client state, so there's no loop.
export function DashboardLiveRefresh() {
  const router = useRouter();
  const lastRefresh = useRef(0);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      // Throttle so a burst of focus/visibility events can't hammer the server.
      const now = Date.now();
      if (now - lastRefresh.current < 3000) return;
      lastRefresh.current = now;
      router.refresh();
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
