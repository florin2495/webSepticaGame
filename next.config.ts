import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  // Shown next to "Setări". Bump package.json "version" (patch) on every push to main.
  // Served under games.hailatat.icu/septica (the hub proxies this path here; Next.js multi-zones).
  basePath: "/septica",
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version, NEXT_PUBLIC_BASE_PATH: "/septica" },
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
