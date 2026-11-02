import type { NextConfig } from "next";

const pages = process.env.GITHUB_PAGES === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  // The dev server is opened at 127.0.0.1 while Next treats localhost as its
  // own host. Without this, script requests from the browser are rejected
  // with 403 and the page never hydrates.
  allowedDevOrigins: ["127.0.0.1"],
  ...(pages
    ? {
        output: "export",
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {
        cacheComponents: true,
        partialPrefetching: true,
      }),
  ...(basePath ? { basePath } : {}),
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
