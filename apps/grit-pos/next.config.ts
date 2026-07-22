import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Neon serverless driver's `ws` dependency breaks at runtime
  // ("mask is not a function") if webpack bundles it — its frame-masking
  // code depends on being loaded via native Node `require`, not bundled.
  // `@prisma/client` is already auto-externalized by Next.js by default,
  // but `ws`/`@neondatabase/serverless`/`@prisma/adapter-neon` are not.
  serverExternalPackages: ["ws", "@neondatabase/serverless", "@prisma/adapter-neon"],
  // Grit packages now ship pre-compiled `dist/*.js` + `.d.ts` output (see
  // packages/*/tsconfig.json + `build` script) instead of raw TypeScript
  // source, so both webpack and Turbopack resolve real `.js` files on disk
  // without needing TS-to-JS resolution help. `@grit/shared-ui` still ships
  // JSX-authored source, but it's compiled down to plain `react-jsx` runtime
  // calls ahead of time, so Next doesn't need to run its own JSX transform
  // over it either — transpilePackages is no longer needed for any of them.
};

export default nextConfig;
