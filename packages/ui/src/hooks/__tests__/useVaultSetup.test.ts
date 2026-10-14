import { describe, expect, test } from "bun:test";
import { VAULT_SETUP_MAX_MS, vaultSetupState } from "../useVaultSetup";

describe("vaultSetupState", () => {
  test("is loading until the server answers", () => {
    expect(vaultSetupState(undefined, 0)).toBe("loading");
  });

  test("sets up while a new account's cards are on their way", () => {
    expect(vaultSetupState({ startedAt: 1000 }, 1000 + 5000)).toBe("settingUp");
  });

  test("hands over to the library once the cards land", () => {
    expect(vaultSetupState(null, 1000)).toBe("ready");
  });

  // A setup that never finishes must not hide the library forever.
  test("gives up after the longest wait", () => {
    expect(
      vaultSetupState({ startedAt: 1000 }, 1000 + VAULT_SETUP_MAX_MS)
    ).toBe("ready");
  });
});
