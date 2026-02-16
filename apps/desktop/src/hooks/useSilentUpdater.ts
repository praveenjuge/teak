import { check } from "@tauri-apps/plugin-updater";
import { useEffect } from "react";

export function useSilentUpdater() {
  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      try {
        const update = await check();
        if (!update || isCancelled) {
          return;
        }

        await update.downloadAndInstall();
      } catch {
        // Intentionally silent to avoid interrupting user flow.
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, []);
}
