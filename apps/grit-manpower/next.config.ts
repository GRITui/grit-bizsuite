import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output is required for packaging (see
  // desktop/grit-bizsuite-desktop/scripts/build-resources.sh) — it prunes
  // node_modules down to only what's actually imported at runtime and
  // emits a self-contained server.js. Has no effect on the normal Vercel
  // deploy path.
  output: "standalone",
  // The Neon serverless driver's `ws` dependency breaks at runtime
  // ("mask is not a function") if webpack/turbopack bundles it — its
  // frame-masking code depends on being loaded via native Node `require`,
  // not bundled. `@prisma/client` is already auto-externalized by Next.js by
  // default, but `ws`/`@neondatabase/serverless`/`@prisma/adapter-neon` are
  // not.
  serverExternalPackages: ["ws", "@neondatabase/serverless", "@prisma/adapter-neon"],
};

export default nextConfig;
