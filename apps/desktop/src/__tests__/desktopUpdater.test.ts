// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { useDesktopUpdater } from "../hooks/useDesktopUpdater";

describe("desktop updater", () => {
  it("exports a hook that returns a no-op interactive check function", () => {
    // The Electron updater runs silently in the main process.
    // The renderer hook is a placeholder for future interactive UI.
    expect(typeof useDesktopUpdater).toBe("function");
  });

  it("checkForUpdatesInteractively resolves without error", async () => {
    // Simulate calling the hook result outside React (just the function)
    const { checkForUpdatesInteractively } = useDesktopUpdater();
    await expect(checkForUpdatesInteractively()).resolves.toBeUndefined();
  });
});
