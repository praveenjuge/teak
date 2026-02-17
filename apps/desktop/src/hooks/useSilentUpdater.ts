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
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn("[useSilentUpdater] Update check failed:", error);
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, []);
}
