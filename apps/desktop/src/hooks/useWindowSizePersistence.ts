import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { readStoreValue, writeStoreValue } from "@/lib/store";

const WINDOW_WIDTH_KEY = "window.width";
const WINDOW_HEIGHT_KEY = "window.height";
const RESIZE_PERSIST_DELAY_MS = 250;

export function useWindowSizePersistence() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let isMounted = true;
    let detachResizeListener: (() => void) | null = null;

    const appWindow = getCurrentWindow();

    const persistWindowSize = (width: number, height: number) => {
      if (timer) {
        clearTimeout(timer);
      }

      timer = setTimeout(() => {
        void Promise.all([
          writeStoreValue(WINDOW_WIDTH_KEY, Math.round(width)),
          writeStoreValue(WINDOW_HEIGHT_KEY, Math.round(height)),
        ]);
      }, RESIZE_PERSIST_DELAY_MS);
    };

    void (async () => {
      const [savedWidth, savedHeight] = await Promise.all([
        readStoreValue<number>(WINDOW_WIDTH_KEY),
        readStoreValue<number>(WINDOW_HEIGHT_KEY),
      ]);

      if (
        isMounted &&
        typeof savedWidth === "number" &&
        typeof savedHeight === "number"
      ) {
        await appWindow.setSize(new LogicalSize(savedWidth, savedHeight));
      }

      detachResizeListener = await appWindow.onResized(({ payload }) => {
        persistWindowSize(payload.width, payload.height);
      });
    })();

    return () => {
      isMounted = false;
      if (detachResizeListener) {
        detachResizeListener();
      }
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, []);
}
