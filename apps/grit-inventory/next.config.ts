import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Neon serverless driver's `ws` dependency breaks at runtime
  // ("mask is not a function") if webpack bundles it — its frame-masking
  // code depends on being loaded via native Node `require`, not bundled.
  // `@prisma/client` is already auto-externalized by Next.js by default,
  // but `ws`/`@neondatabase/serverless`/`@prisma/adapter-neon` are not.
  serverExternalPackages: ["ws", "@neondatabase/serverless", "@prisma/adapter-neon"],
  // Grit workspace packages now ship pre-compiled `dist/*.js` + `.d.ts`
  // output (see packages/*/tsconfig.json + `build` script) instead of raw
  // TypeScript source, so both webpack and Turbopack resolve real `.js`
  // files on disk directly — no transpilePackages or extensionAlias needed
  // anymore.
};

export default nextConfig;
