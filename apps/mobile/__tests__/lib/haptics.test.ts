import { afterEach, describe, expect, test } from "bun:test";
import {
  triggerCardTapHaptic,
  triggerSuccessHaptic,
  triggerValidationErrorHaptic,
} from "../../lib/haptics";

const originalExpoOs = process.env.EXPO_OS;

afterEach(() => {
  process.env.EXPO_OS = originalExpoOs;
});

function createHapticsMock() {
  const calls: string[] = [];

  return {
    calls,
    api: {
      ImpactFeedbackStyle: {
        Light: "light",
      },
      NotificationFeedbackType: {
        Error: "error",
        Success: "success",
      },
      impactAsync: async (style: string) => {
        calls.push(`impact:${style}`);
      },
      notificationAsync: async (type: string) => {
        calls.push(`notification:${type}`);
      },
    },
  };
}

describe("haptics", () => {
  test("triggers light impact when opening a card on iOS", async () => {
    process.env.EXPO_OS = "ios";
    const { api, calls } = createHapticsMock();

    await triggerCardTapHaptic(api as any);

    expect(calls).toEqual(["impact:light"]);
  });

  test("triggers success notification on iOS", async () => {
    process.env.EXPO_OS = "ios";
    const { api, calls } = createHapticsMock();

    await triggerSuccessHaptic(api as any);

    expect(calls).toEqual(["notification:success"]);
  });

  test("triggers error notification on validation failure on iOS", async () => {
    process.env.EXPO_OS = "ios";
    const { api, calls } = createHapticsMock();

    await triggerValidationErrorHaptic(api as any);

    expect(calls).toEqual(["notification:error"]);
  });

  test("skips haptics on non-iOS platforms", async () => {
    process.env.EXPO_OS = "android";
    const { api, calls } = createHapticsMock();

    await triggerCardTapHaptic(api as any);
    await triggerSuccessHaptic(api as any);
    await triggerValidationErrorHaptic(api as any);

    expect(calls.length).toBe(0);
  });

  test("never throws when native haptics call fails", async () => {
    process.env.EXPO_OS = "ios";

    await triggerCardTapHaptic({
      ImpactFeedbackStyle: {
        Light: "light",
      },
      NotificationFeedbackType: {
        Error: "error",
        Success: "success",
      },
      impactAsync: async () => {
        throw new Error("native haptics unavailable");
      },
      notificationAsync: async () => {
        // no-op
      },
    } as any);

    expect(true).toBe(true);
  });
});
