import { sentryVitePlugin } from "@sentry/vite-plugin";
import { buildDesktopRelease } from "@teak/convex/shared/telemetry";
import packageJson from "./package.json";

const authToken = process.env.SENTRY_AUTH_TOKEN?.trim();
const release =
  process.env.SENTRY_RELEASE?.trim() ||
  buildDesktopRelease(
    packageJson.version,
    process.env.VITE_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA
  );

export const sentryDesktopPlugins = (assets: string, sourceMaps: string) =>
  sentryVitePlugin({
    authToken,
    org: "teakvault",
    project: "teak-desktop-prod",
    release: {
      create: Boolean(authToken),
      finalize: false,
      inject: true,
      name: release,
      setCommits: authToken ? { auto: true, ignoreMissing: true } : false,
    },
    sourcemaps: {
      assets,
      disable: authToken ? false : "disable-upload",
      filesToDeleteAfterUpload: authToken ? sourceMaps : undefined,
    },
  });
