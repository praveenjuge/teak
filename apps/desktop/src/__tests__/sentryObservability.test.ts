// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  desktopTracesSampler,
  resolveDesktopEnvironment,
  resolveDesktopRelease,
  resolveDesktopUserId,
  scrubDesktopPayload,
} from "../sentry-config";

const desktopRoot = resolve(import.meta.dir, "../..");
const repoRoot = resolve(desktopRoot, "../..");

describe("desktop Sentry observability", () => {
  test("builds canonical release, environment, and pseudonymous user", async () => {
    const sha = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";
    expect(resolveDesktopEnvironment("prod", "production")).toBe("production");
    expect(resolveDesktopRelease("1.0.56", sha)).toBe(
      "teak-desktop@1.0.56+abcdef0123456789abcdef0123456789abcdef01"
    );
    const id = await resolveDesktopUserId("install-device-id");
    expect(id).toHaveLength(64);
    expect(id).not.toContain("install-device-id");
  });

  test("retains high-value production traces and scrubs credentials", () => {
    expect(
      desktopTracesSampler({ name: "desktop.navigation" }, "production")
    ).toBe(0.2);
    expect(
      desktopTracesSampler({ name: "desktop.oauth.callback" }, "production")
    ).toBe(1);
    expect(
      scrubDesktopPayload({ password: "secret", sessionToken: "sensitive" })
    ).toEqual({ password: "[REDACTED]", sessionToken: "[REDACTED]" });
  });

  test("initializes main, preload, and renderer before application code", () => {
    const main = readFileSync(
      resolve(desktopRoot, "src/main/index.ts"),
      "utf8"
    );
    const bootstrap = readFileSync(
      resolve(desktopRoot, "src/main/bootstrap.ts"),
      "utf8"
    );
    const preload = readFileSync(
      resolve(desktopRoot, "src/preload/index.ts"),
      "utf8"
    );
    const renderer = readFileSync(resolve(desktopRoot, "src/main.tsx"), "utf8");
    const mainSentry = readFileSync(
      resolve(desktopRoot, "src/main/sentry.ts"),
      "utf8"
    );

    expect(bootstrap.trimStart().startsWith('import "./sentry"')).toBe(true);
    expect(bootstrap).toContain('await import("./index")');
    expect(
      preload.trimStart().startsWith('import "@sentry/electron/preload"')
    ).toBe(true);
    expect(renderer.trimStart().startsWith('import "./sentry"')).toBe(true);
    expect(
      readFileSync(resolve(desktopRoot, "src/sentry.ts"), "utf8")
    ).toContain("enableLogs: true");
    expect(mainSentry).toContain("rendererEventLoopBlockIntegration");
    expect(mainSentry).toContain("startupTracingIntegration");
    expect(mainSentry).toContain("attachScreenshot: false");
    expect(main).toContain('webContents.on("render-process-gone"');
    expect(main).toContain("desktop.updater");
    expect(main).toContain("desktop.oauth");
  });

  test("contains desktop user synchronization failures", () => {
    const rendererSentry = readFileSync(
      resolve(desktopRoot, "src/sentry.ts"),
      "utf8"
    );
    const syncUser = rendererSentry.slice(
      rendererSentry.indexOf("export const syncDesktopSentryUser"),
      rendererSentry.indexOf('if (typeof window !== "undefined"')
    );

    expect(syncUser).toContain("try {");
    expect(syncUser).toContain("catch (error)");
    expect(syncUser).toContain('operation: "desktop.user.sync"');
    expect(syncUser).toContain(
      "Telemetry failures must not create renderer rejections."
    );
  });

  test("contains desktop app-version context failures", () => {
    const rendererSentry = readFileSync(
      resolve(desktopRoot, "src/sentry.ts"),
      "utf8"
    );
    const versionContext = rendererSentry.slice(
      rendererSentry.indexOf('if (typeof window !== "undefined"'),
      rendererSentry.length
    );

    expect(versionContext).toContain(".catch((error: unknown) => {");
    expect(versionContext).toContain('operation: "desktop.app.version"');
    expect(versionContext).toContain(
      "Telemetry context lookup must never create a renderer rejection."
    );
  });

  test("uploads every desktop source map and strips distributable maps", () => {
    for (const config of [
      "vite.main.config.ts",
      "vite.preload.config.ts",
      "vite.renderer.config.ts",
    ]) {
      const source = readFileSync(resolve(desktopRoot, config), "utf8");
      expect(source).toContain("sentryDesktopPlugins");
      expect(source).toContain('sourcemap: "hidden"');
    }

    const workflow = readFileSync(
      resolve(repoRoot, ".github/workflows/desktop-release.yml"),
      "utf8"
    );
    expect(workflow).toContain("sentry-dbid-");
    expect(workflow).toContain("debug-files upload");
    expect(workflow).toContain("find .vite -name '*.map'");
  });
});
