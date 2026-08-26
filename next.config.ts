import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Don't reuse a cached client-side render of a dynamic page when navigating
    // to it — live pages (dashboard, invoice lists, reports) must reflect the
    // latest data as soon as the user opens them, not only after a hard refresh.
    staleTimes: {
      dynamic: 0,
    },
  },
};

export default nextConfig;
