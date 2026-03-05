import { getVersion } from "@tauri-apps/api/app";
import {
  confirm,
  message,
  type ConfirmDialogOptions,
  type MessageDialogOptions,
} from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef } from "react";

const DEFAULT_APP_NAME = "Teak";

export type DesktopUpdateCheckMode = "silent" | "interactive";

interface AvailableDesktopUpdate {
  body?: string;
  currentVersion: string;
  downloadAndInstall: () => Promise<void>;
  version: string;
}

interface DesktopUpdaterDependencies {
  checkForUpdate: () => Promise<AvailableDesktopUpdate | null>;
  confirmDialog: (
    message: string,
    options?: string | ConfirmDialogOptions
  ) => Promise<boolean>;
  getCurrentVersion: () => Promise<string>;
  messageDialog: (
    message: string,
    options?: string | MessageDialogOptions
  ) => Promise<unknown>;
}

interface RunDesktopUpdateCheckOptions {
  appName?: string;
  dependencies?: DesktopUpdaterDependencies;
  isCancelled?: () => boolean;
}

const defaultDependencies: DesktopUpdaterDependencies = {
  checkForUpdate: check,
  confirmDialog: confirm,
  getCurrentVersion: getVersion,
  messageDialog: message,
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "Unknown error";
}

export async function runDesktopUpdateCheck(
  mode: DesktopUpdateCheckMode,
  options: RunDesktopUpdateCheckOptions = {}
): Promise<void> {
  const appName = options.appName ?? DEFAULT_APP_NAME;
  const dependencies = options.dependencies ?? defaultDependencies;
  const isCancelled = options.isCancelled ?? (() => false);

  try {
    const update = await dependencies.checkForUpdate();
    if (isCancelled()) {
      return;
    }

    if (!update) {
      if (mode === "interactive") {
        const currentVersion = await dependencies
          .getCurrentVersion()
          .catch(() => "current");

        if (isCancelled()) {
          return;
        }

        await dependencies.messageDialog(
          `${appName} ${currentVersion} is currently the newest version available.`,
          {
            buttons: { ok: "OK" },
            kind: "info",
            title: "You're up to date!",
          }
        );
      }
      return;
    }

    if (mode === "interactive") {
      const releaseNotes = update.body?.trim()
        ? `\n\nRelease notes:\n${update.body.trim()}`
        : "";
      const shouldInstall = await dependencies.confirmDialog(
        `${appName} ${update.version} is available (current: ${update.currentVersion}).${releaseNotes}\n\nInstall now?`,
        {
          cancelLabel: "Not now",
          kind: "info",
          okLabel: "Install",
          title: "Update Available",
        }
      );

      if (!shouldInstall || isCancelled()) {
        return;
      }
    }

    await update.downloadAndInstall();
    if (isCancelled() || mode !== "interactive") {
      return;
    }

    await dependencies.messageDialog(
      `${appName} ${update.version} has been installed. Restart may be required if the app does not relaunch automatically.`,
      {
        buttons: { ok: "OK" },
        kind: "info",
        title: "Update Installed",
      }
    );
  } catch (error) {
    if (mode === "interactive" && !isCancelled()) {
      await dependencies.messageDialog(
        `Unable to check for updates right now.\n\n${getErrorMessage(error)}`,
        {
          buttons: { ok: "OK" },
          kind: "error",
          title: "Update Check Failed",
        }
      );
    }

    if (import.meta.env.DEV) {
      console.warn("[useDesktopUpdater] Update check failed:", error);
    }
  }
}

export function useDesktopUpdater() {
  const isCancelledRef = useRef(false);

  const runUpdateCheck = useCallback(
    async (mode: DesktopUpdateCheckMode) => {
      await runDesktopUpdateCheck(mode, {
        isCancelled: () => isCancelledRef.current,
      });
    },
    []
  );

  useEffect(() => {
    isCancelledRef.current = false;
    void runUpdateCheck("silent");

    return () => {
      isCancelledRef.current = true;
    };
  }, [runUpdateCheck]);

  const checkForUpdatesInteractively = useCallback(async () => {
    await runUpdateCheck("interactive");
  }, [runUpdateCheck]);

  return {
    checkForUpdatesInteractively,
  };
}
