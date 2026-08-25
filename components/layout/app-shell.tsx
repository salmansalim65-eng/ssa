"use client";

import { type ReactNode, useSyncExternalStore } from "react";

import { WorkspaceTabs } from "./workspace-tabs";
import { isEmbeddedWindow } from "./workspace-store";

// Read "am I inside an iframe?" without a hydration mismatch: the server (and
// first client render) get `false`, then the client reconciles to the real
// value. The value never changes for a given window, so no subscription is
// needed.
function useIsEmbedded(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => isEmbeddedWindow(),
    () => false,
  );
}

// Wraps the app chrome. In the top window it renders the sidebar, header and the
// tabbed workspace. Inside a workspace tab (an iframe), it renders ONLY the page
// content — no sidebar/header/tabs — so tabs never nest their own chrome.
export function AppShell({
  sidebar,
  header,
  children,
}: {
  sidebar: ReactNode;
  header: ReactNode;
  children: ReactNode;
}) {
  const embedded = useIsEmbedded();

  if (embedded) {
    // No header inside a tab, so full-height reports only need to subtract their
    // own padding (the --vh-offset), not a header height.
    return <main className="p-4 [--vh-offset:2rem] sm:p-6 sm:[--vh-offset:3rem]">{children}</main>;
  }

  return (
    <div className="flex min-h-screen flex-1">
      {sidebar}
      <div className="flex min-w-0 flex-1 flex-col">
        {header}
        <WorkspaceTabs>{children}</WorkspaceTabs>
      </div>
    </div>
  );
}
