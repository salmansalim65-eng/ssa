"use client";

import { useEffect } from "react";

/**
 * The count on the installed app's icon — the dot on the taskbar, dock or home
 * screen that says something is waiting without the app being open.
 *
 * It mirrors the two bells in the header, so the icon and the header never give
 * different answers. Setting it to 0 clears the badge rather than drawing a
 * zero: a badge that is always there is one nobody reads.
 *
 * Only an INSTALLED app has an icon to badge, so this does nothing in an
 * ordinary browser tab, and nothing at all where the browser has no Badging
 * API (Firefox, and Safari outside an installed app). Every call is guarded:
 * the badge is a nicety, and it must never be the reason a page throws.
 */
export function AppBadge({ count }: { count: number }) {
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (!nav.setAppBadge || !nav.clearAppBadge) return;

    const apply = count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge();
    // A rejection here means the platform refused the badge (not installed, no
    // permission). Nothing to recover — and nothing worth breaking a page over.
    apply?.catch(() => {});
  }, [count]);

  return null;
}
