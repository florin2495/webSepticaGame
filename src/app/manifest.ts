import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Șeptică",
    short_name: "Șeptică",
    description: "Șeptică multiplayer între prieteni, 2-4 jucători, și pe echipe.",
    id: "/septica/",
    start_url: "/septica/",
    // "/" on purpose: leaving the game for the hub (same origin) stays inside the installed app.
    scope: "/",
    display: "standalone",
    lang: "ro",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/septica/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/septica/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/septica/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
