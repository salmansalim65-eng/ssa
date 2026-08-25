"use client";

import { useSyncExternalStore } from "react";

// A tiny in-memory store for the ERP's in-app tab workspace. Clicking a sidebar
// item opens the target route as a tab (rendered in an isolated iframe) instead
// of navigating the whole window, so several reports/vouchers stay open at once.
// Kept intentionally simple (module singleton + useSyncExternalStore) and NOT
// persisted, so a hard browser refresh starts clean and nothing leaks across
// windows.

export interface WorkspaceTab {
  id: string;
  href: string;
  title: string;
}

let tabs: WorkspaceTab[] = [];
let activeId: string | null = null; // null → show the base "home" content
let snapshot: { tabs: WorkspaceTab[]; activeId: string | null } = { tabs, activeId };

const EMPTY_SNAPSHOT = snapshot;
const listeners = new Set<() => void>();

function emit() {
  snapshot = { tabs, activeId };
  for (const l of listeners) l();
}

function nextId(): string {
  return `wt_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Open (or focus, if already open) a route as a workspace tab. */
export function openTab(href: string, title: string) {
  const existing = tabs.find((t) => t.href === href);
  if (existing) {
    activeId = existing.id;
  } else {
    const tab: WorkspaceTab = { id: nextId(), href, title };
    tabs = [...tabs, tab];
    activeId = tab.id;
  }
  emit();
}

/** Close a tab; focus a sensible neighbour (or home when none remain). */
export function closeTab(id: string) {
  const index = tabs.findIndex((t) => t.id === id);
  if (index === -1) return;
  const closingActive = activeId === id;
  tabs = tabs.filter((t) => t.id !== id);
  if (closingActive) {
    const neighbour = tabs[index] ?? tabs[index - 1] ?? null;
    activeId = neighbour ? neighbour.id : null;
  }
  emit();
}

export function setActive(id: string | null) {
  activeId = id;
  emit();
}

/** Show the base "home" surface without closing any open tabs. */
export function goHome() {
  activeId = null;
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useWorkspace() {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY_SNAPSHOT,
  );
}

/** True when the current window is running inside an iframe (a workspace tab). */
export function isEmbeddedWindow(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.top !== window.self;
  } catch {
    // Cross-origin access throws — treat as embedded.
    return true;
  }
}
