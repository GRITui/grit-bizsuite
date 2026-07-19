import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Neon serverless driver's `ws` dependency breaks at runtime
  // ("mask is not a function") if webpack/turbopack bundles it — its
  // frame-masking code depends on being loaded via native Node `require`,
  // not bundled. `@prisma/client` is already auto-externalized by Next.js by
  // default, but `ws`/`@neondatabase/serverless`/`@prisma/adapter-neon` are
  // not.
  serverExternalPackages: ["ws", "@neondatabase/serverless", "@prisma/adapter-neon"],
};

export default nextConfig;
