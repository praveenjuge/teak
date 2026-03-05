// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { runDesktopUpdateCheck } from "../hooks/useDesktopUpdater";

function createDependencies(overrides: Record<string, unknown> = {}) {
  const calls = {
    confirm: [],
    currentVersion: 0,
    install: [],
    message: [],
  };

  const update = {
    body: "Release notes",
    currentVersion: "1.0.0",
    downloadAndInstall: async () => {
      calls.install.push(true);
    },
    version: "1.1.0",
  };

  const dependencies = {
    checkForUpdate: async () => null,
    confirmDialog: async (...args: unknown[]) => {
      calls.confirm.push(args);
      return true;
    },
    getCurrentVersion: async () => {
      calls.currentVersion += 1;
      return "1.0.0";
    },
    messageDialog: async (...args: unknown[]) => {
      calls.message.push(args);
      return "Ok";
    },
    ...overrides,
  };

  return { calls, dependencies, update };
}

describe("desktop updater", () => {
  it("shows native up-to-date dialog when no update exists in interactive mode", async () => {
    const { calls, dependencies } = createDependencies();

    await runDesktopUpdateCheck("interactive", { dependencies });

    expect(calls.currentVersion).toBe(1);
    expect(calls.confirm).toHaveLength(0);
    expect(calls.install).toHaveLength(0);
    expect(calls.message).toHaveLength(1);
    expect(calls.message[0][0]).toContain("Teak 1.0.0 is currently the newest");
  });

  it("downloads and installs after user confirms update", async () => {
    const { calls, dependencies, update } = createDependencies({
      checkForUpdate: async () => update,
      confirmDialog: async (...args: unknown[]) => {
        calls.confirm.push(args);
        return true;
      },
    });

    await runDesktopUpdateCheck("interactive", { dependencies });

    expect(calls.confirm).toHaveLength(1);
    expect(calls.install).toHaveLength(1);
    expect(calls.message).toHaveLength(1);
    expect(calls.message[0][0]).toContain("has been installed");
  });

  it("does not install when user declines update", async () => {
    const { calls, dependencies, update } = createDependencies({
      checkForUpdate: async () => update,
      confirmDialog: async (...args: unknown[]) => {
        calls.confirm.push(args);
        return false;
      },
    });

    await runDesktopUpdateCheck("interactive", { dependencies });

    expect(calls.confirm).toHaveLength(1);
    expect(calls.install).toHaveLength(0);
    expect(calls.message).toHaveLength(0);
  });

  it("shows native error dialog when interactive check fails", async () => {
    const { calls, dependencies } = createDependencies({
      checkForUpdate: async () => {
        throw new Error("Network unavailable");
      },
    });

    await runDesktopUpdateCheck("interactive", { dependencies });

    expect(calls.install).toHaveLength(0);
    expect(calls.message).toHaveLength(1);
    expect(calls.message[0][0]).toContain("Unable to check for updates");
    expect(calls.message[0][0]).toContain("Network unavailable");
  });

  it("keeps startup silent checks dialog-free while still installing updates", async () => {
    const { calls, dependencies, update } = createDependencies({
      checkForUpdate: async () => update,
    });

    await runDesktopUpdateCheck("silent", { dependencies });

    expect(calls.install).toHaveLength(1);
    expect(calls.confirm).toHaveLength(0);
    expect(calls.message).toHaveLength(0);
  });
});
