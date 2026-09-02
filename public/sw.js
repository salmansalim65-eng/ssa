// Service worker for SSA ERP push notifications.
//
// Deliberately minimal: it does not cache or intercept fetches, it only
// receives pushes and opens the app where the notification points. Keeping it
// out of the network path means it can never serve a stale page.

self.addEventListener("install", () => {
  // Take over straight away so the first subscription can receive a push
  // without the user reloading the app.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "SSA ERP";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // A tag replaces the previous notification of the same kind instead of
    // stacking a new one for every voucher.
    tag: data.tag || "ssa-erp",
    renotify: Boolean(data.tag),
    data: { url: data.url || "/dashboard" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Reuse a window that already has the app open rather than piling up tabs.
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client) client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
