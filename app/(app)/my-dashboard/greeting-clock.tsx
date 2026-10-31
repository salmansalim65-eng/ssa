"use client";

import { useSyncExternalStore } from "react";

/**
 * The current time, as an external store rather than state set from an effect.
 *
 * A clock is client-only by nature: rendered on the server it is wrong on
 * arrival, and the two machines need not even share a time zone. Reading it
 * through useSyncExternalStore gives the server (and the first client render)
 * nothing, so there is no hydration mismatch, and the real time arrives on
 * subscribe. One interval serves every reader and stops with the last of them.
 */
let nowMs = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!timer) {
    nowMs = Date.now();
    timer = setInterval(() => {
      nowMs = Date.now();
      for (const l of listeners) l();
    }, 1000);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** 0 until the browser has subscribed — "we do not know the time yet". */
const readNow = () => nowMs;
const readNowOnServer = () => 0;

function useNow(): Date | null {
  const ms = useSyncExternalStore(subscribe, readNow, readNowOnServer);
  return ms ? new Date(ms) : null;
}

/** The date and time under the greeting, ticking. */
export function GreetingClock() {
  const now = useNow();
  return (
    // The height is held whether or not the time is known, so nothing below it
    // jumps when the clock appears.
    <p className="min-h-5 text-sm text-muted-foreground">
      {now && (
        <>
          {now.toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
          {" · "}
          <span className="tabular-nums">{now.toLocaleTimeString()}</span>
        </>
      )}
    </p>
  );
}

/** Morning, afternoon or evening — by the reader's own clock, not the server's. */
export function Greeting({ name }: { name: string }) {
  const now = useNow();
  const hour = now?.getHours();
  const part =
    hour === undefined ? "Hello" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
      {/* "Hello" until the browser says which part of the day it is: the
          heading is never blank, and never swaps to a wrong greeting first. */}
      {part}
      {name ? `, ${name}` : ""}
    </h1>
  );
}
