import path from "node:path";
import type { NextConfig } from "next";
import packageJson from "./package.json";
import { uploadBrowserSourceMaps } from "./posthog-sourcemaps";
import { resolvePostHogToken } from "./src/lib/posthog-config";
import { staticSecurityHeaders } from "./src/lib/security-headers";

const workspaceRoot = path.resolve(process.cwd(), "../..");
const releaseSha =
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  process.env.GIT_SHA;
const posthogToken = resolvePostHogToken({
  token: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
  vercelEnvironment: process.env.VERCEL_ENV,
});
// Source maps go to PostHog only from production builds with CLI credentials
// (POSTHOG_CLI_API_KEY and POSTHOG_CLI_PROJECT_ID, read by posthog-cli).
const uploadSourceMaps = Boolean(
  posthogToken &&
    process.env.POSTHOG_CLI_API_KEY?.trim() &&
    process.env.POSTHOG_CLI_PROJECT_ID?.trim()
);

process.env.NEXT_PUBLIC_APP_VERSION = packageJson.version;
if (releaseSha) {
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA = releaseSha;
}
const singletonAliasTargets = {
  convex: path.join(workspaceRoot, "node_modules/convex"),
  "convex/react": path.join(workspaceRoot, "node_modules/convex/react"),
  "convex/browser": path.join(workspaceRoot, "node_modules/convex/browser"),
  "convex-helpers": path.join(workspaceRoot, "node_modules/convex-helpers"),
  react: path.join(workspaceRoot, "node_modules/react"),
  "react-dom": path.join(workspaceRoot, "node_modules/react-dom"),
} as const;

const toRelativeSpecifier = (absolutePath: string): string => {
  const relativePath = path.relative(process.cwd(), absolutePath);
  return relativePath.split(path.sep).join("/");
};

const turbopackSingletonAliases = Object.fromEntries(
  Object.entries(singletonAliasTargets).map(([packageName, targetPath]) => [
    packageName,
    toRelativeSpecifier(targetPath),
  ])
);

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
    // Inlined only for production deployments; every other build sends nothing.
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: posthogToken ?? "",
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: releaseSha,
  },
  reactCompiler: true,
  experimental: {
    sri: {
      algorithm: "sha384",
    },
    turbopackFileSystemCacheForBuild: true,
    turbopackRustReactCompiler: true,
  },
  turbopack: {
    resolveAlias: turbopackSingletonAliases,
    // Stable chunk ids that PostHog matches to uploaded source maps.
    debugIds: uploadSourceMaps,
  },
  productionBrowserSourceMaps: uploadSourceMaps,
  compiler: {
    runAfterProductionCompile: async ({ distDir }) => {
      if (uploadSourceMaps) {
        await uploadBrowserSourceMaps(distDir, {
          releaseName: "teak-web",
          releaseVersion: releaseSha
            ? `${packageJson.version}+${releaseSha.slice(0, 12)}`
            : packageJson.version,
        });
      }
    },
  },
  // PostHog's endpoints end in a slash (/e/, /flags/); src/proxy.ts proxies them.
  skipTrailingSlashRedirect: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: staticSecurityHeaders,
      },
    ];
  },
};

export default nextConfig;
