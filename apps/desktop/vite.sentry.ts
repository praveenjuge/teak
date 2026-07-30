import { sentryVitePlugin } from "@sentry/vite-plugin";
import packageJson from "./package.json";

// Keep this local so Vite can load the config under Node's ESM loader
// without resolving workspace `.ts` package exports at config-eval time.
const buildDesktopRelease = (
  version: string | undefined,
  sha: string | undefined
): string | undefined => {
  const normalizedVersion = version?.trim().replace(/^v/u, "");
  const normalizedSha = sha?.trim().toLowerCase();
  if (
    !(
      normalizedVersion &&
      normalizedSha &&
      /^[a-f0-9]{7,64}$/u.test(normalizedSha)
    )
  ) {
    return;
  }
  return `teak-desktop@${normalizedVersion}+${normalizedSha.slice(0, 40)}`;
};

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
