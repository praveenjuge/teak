let openingPromise: Promise<void> | null = null;

export const openAuthWindow = async (url: string): Promise<void> => {
  if (!openingPromise) {
    openingPromise = window.teakDesktop.auth
      .openWindow(url)
      .finally(() => {
        openingPromise = null;
      });
  }

  await openingPromise;
};

export const closeAuthWindow = async (): Promise<void> => {
  await window.teakDesktop.auth.closeWindow();
};
