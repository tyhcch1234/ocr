import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // The dev server is opened at 127.0.0.1 while Next treats localhost as its
  // own host. Without this, script requests from the browser are rejected
  // with 403 and the page never hydrates.
  allowedDevOrigins: ["127.0.0.1"],
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
