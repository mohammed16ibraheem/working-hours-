import type { NextConfig } from "next";

const BACKEND = process.env.WH_BACKEND_URL || "http://127.0.0.1:3001";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  // Proxied via nginx Host admin.alyaqeenadv.com — without this, Next 16 blocks
  // cross-origin /_next/dev endpoints and client Suspense never resolves.
  allowedDevOrigins: [
    "admin.alyaqeenadv.com",
    "panel.alyaqeenadv.com",
    "whours.alyaqeenadv.com",
    "hours.alyaqeenadv.com",
    "workhours.nammaalenjaz.com",
    "hours.nammaalenjaz.com",
    "whours.nammaalenjaz.com",
    "169.58.150.63",
  ],
  cacheComponents: true,
  partialPrefetching: true,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND}/api/:path*`,
      },
    ];
  },
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
