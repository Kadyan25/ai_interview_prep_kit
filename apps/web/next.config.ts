import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The shared package ships TypeScript source so the API, the CLI and the web
  // app all read the same kit contract with no build step in between.
  transpilePackages: ["@prep/shared"],
  async rewrites() {
    // Keeps the auth cookie first-party: the browser only ever talks to its own
    // origin, and Next forwards to the API.
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
