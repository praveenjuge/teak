/**
 * Desktop updater hook.
 *
 * In the Electron implementation, silent auto-update checks run in the main
 * process via electron-updater on app launch. Interactive "Check for Updates…"
 * menu/dialog is intentionally postponed per the migration spec.
 *
 * This hook is kept as a no-op placeholder so the renderer API surface stays
 * consistent and the interactive flow can be wired up later.
 */
export function useDesktopUpdater() {
  return {
    // Intentionally a no-op — silent updates are handled in the main process.
    checkForUpdatesInteractively: async () => {},
  };
}
