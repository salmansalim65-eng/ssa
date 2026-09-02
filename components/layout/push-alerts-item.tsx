"use client";

import { useEffect, useState } from "react";
import { BellIcon, BellOffIcon, BellRingIcon } from "lucide-react";
import { toast } from "sonner";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { removePushSubscription, savePushSubscription } from "@/features/notifications/actions";

type State = "loading" | "unsupported" | "unconfigured" | "off" | "on" | "blocked";

/** The VAPID public key travels as base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function keyToBase64(key: ArrayBuffer | null) {
  if (!key) return "";
  return window.btoa(String.fromCharCode(...new Uint8Array(key)));
}

/**
 * Turns phone alerts on or off for THIS device. Each browser (and each phone)
 * subscribes separately, which is how web push works — so the menu item shows
 * the state of the device it is being read on.
 *
 * On iPhone the browser only offers push once the app has been added to the
 * home screen; until then the entry says so rather than failing silently.
 */
export function PushAlertsItem() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

  useEffect(() => {
    let cancelled = false;
    async function read() {
      const supported =
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;
      if (!supported) {
        if (!cancelled) setState("unsupported");
        return;
      }
      // The browser can do it but this deployment has no VAPID key — worth
      // saying, since otherwise the entry just isn't there and nobody can tell
      // the two apart.
      if (!publicKey) {
        if (!cancelled) setState("unconfigured");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setState("blocked");
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const existing = await registration?.pushManager.getSubscription();
      if (!cancelled) setState(existing ? "on" : "off");
    }
    void read();
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const result = await savePushSubscription({
        endpoint: subscription.endpoint,
        p256dh: keyToBase64(subscription.getKey("p256dh")),
        auth: keyToBase64(subscription.getKey("auth")),
        userAgent: navigator.userAgent,
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      setState("on");
      toast.success("Alerts on for this device");
    } catch {
      toast.error("Could not turn on alerts on this device.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await removePushSubscription(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setState("off");
      toast.success("Alerts off for this device");
    } catch {
      toast.error("Could not turn off alerts.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading" || state === "unsupported") return null;

  if (state === "unconfigured") {
    return (
      <DropdownMenuItem disabled>
        <BellOffIcon /> Alerts not set up on the server
      </DropdownMenuItem>
    );
  }

  if (state === "blocked") {
    return (
      <DropdownMenuItem disabled>
        <BellOffIcon /> Alerts blocked in browser settings
      </DropdownMenuItem>
    );
  }

  const on = state === "on";
  return (
    <DropdownMenuItem
      disabled={busy}
      // Keep the menu open while the browser's permission prompt is up.
      onSelect={(event) => {
        event.preventDefault();
        void (on ? disable() : enable());
      }}
    >
      {on ? <BellRingIcon /> : <BellIcon />}
      {on ? "Turn off alerts on this device" : "Get alerts on this device"}
    </DropdownMenuItem>
  );
}
