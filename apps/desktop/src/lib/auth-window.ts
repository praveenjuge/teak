import {
  type WebviewWindow as TauriWebviewWindow,
  WebviewWindow,
} from "@tauri-apps/api/webviewWindow";

const AUTH_WINDOW_LABEL = "auth";

let openingPromise: Promise<TauriWebviewWindow> | null = null;

const createAuthWindow = async (url: string): Promise<TauriWebviewWindow> => {
  const existingWindow = await WebviewWindow.getByLabel(AUTH_WINDOW_LABEL);
  if (existingWindow) {
    await existingWindow.close().catch(() => undefined);
  }

  return await new Promise<TauriWebviewWindow>((resolve, reject) => {
    const authWindow = new WebviewWindow(AUTH_WINDOW_LABEL, {
      url,
      title: "Teak Login",
      width: 480,
      height: 760,
      center: true,
      resizable: true,
      fullscreen: false,
      focus: true,
      // Force fresh auth state each time so users can switch accounts on re-login.
      incognito: true,
    });

    void authWindow.once("tauri://created", async () => {
      await authWindow.show().catch(() => undefined);
      await authWindow.setFocus().catch(() => undefined);
      resolve(authWindow);
    });

    void authWindow.once("tauri://error", (event) => {
      const message =
        typeof event.payload === "string"
          ? event.payload
          : "Unable to open login window";
      reject(new Error(message));
    });
  });
};

export const openAuthWindow = async (url: string): Promise<void> => {
  if (!openingPromise) {
    openingPromise = createAuthWindow(url).finally(() => {
      openingPromise = null;
    });
  }

  await openingPromise;
};

export const closeAuthWindow = async (): Promise<void> => {
  const authWindow = await WebviewWindow.getByLabel(AUTH_WINDOW_LABEL);
  if (!authWindow) {
    return;
  }

  await authWindow.close().catch(() => undefined);
};
