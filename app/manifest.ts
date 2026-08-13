import type { MetadataRoute } from "next";

// Web app manifest so the SSA logo appears when the app is installed (PWA)
// on desktop or mobile home screens.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rental & Accounting ERP",
    short_name: "SSA ERP",
    description: "Multi-company, multi-currency rental and accounting ERP",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1f7a3d",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
