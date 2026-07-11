import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";
import { buildWebRelease } from "@teak/convex/shared/telemetry";
import type { NextConfig } from "next";
import packageJson from "./package.json";
import { staticSecurityHeaders } from "./src/lib/security-headers";

const workspaceRoot = path.resolve(process.cwd(), "../..");
const releaseSha =
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  process.env.GIT_SHA;
const sentryRelease = buildWebRelease(packageJson.version, releaseSha);

process.env.NEXT_PUBLIC_APP_VERSION = packageJson.version;
if (releaseSha) {
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA = releaseSha;
}
if (sentryRelease) {
  process.env.SENTRY_RELEASE = sentryRelease;
  process.env.NEXT_PUBLIC_SENTRY_RELEASE = sentryRelease;
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
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
    NEXT_PUBLIC_SENTRY_RELEASE: sentryRelease,
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: releaseSha,
  },
  reactCompiler: true,
  experimental: {
    turbopackFileSystemCacheForDev: true,
  },
  allowedDevOrigins: ["app.teak.localhost"],
  turbopack: {
    resolveAlias: turbopackSingletonAliases,
  },
  webpack(config) {
    config.resolve ??= {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      ...singletonAliasTargets,
    };
    return config;
  },
  async rewrites() {
    return [];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: staticSecurityHeaders,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "teakvault",

  project: "teak-web-prod",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,
  release: {
    name: sentryRelease,
    setCommits: {
      auto: true,
      // Avoid hard failures when Sentry cannot derive a compare range
      // (e.g. first release, rebased history, or missing previous commit).
      ignoreMissing: true,
      ignoreEmpty: true,
    },
  },

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Automatically tree-shake Sentry logger statements to reduce bundle size
    treeshake: {
      removeDebugLogging: true,
    },
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,
  },
});
