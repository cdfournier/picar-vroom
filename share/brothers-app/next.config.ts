import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@anthropic-ai/sdk"],
  turbopack: {
    root: __dirname,
  },
  // Hide the Next.js dev indicator (the "N" logo) that overlaps the chat input
  devIndicators: false,
};

export default nextConfig;
