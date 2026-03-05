import { afterEach, describe, expect, mock, test } from "bun:test";
import { openCustomerPortal } from "@teak/ui/lib/customerPortal";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("openCustomerPortal", () => {
  test("opens customer portal in a new tab from action URL", async () => {
    const createCustomerPortal = mock(async () => "https://portal.example.com");
    const openWindow = mock(() => ({ closed: false }));

    await openCustomerPortal({
      createCustomerPortal,
      openWindow,
    });

    expect(createCustomerPortal).toHaveBeenCalledTimes(1);
    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(openWindow).toHaveBeenCalledWith(
      "https://portal.example.com",
      "_blank",
      "noopener,noreferrer"
    );
  });

  test("throws when popup is blocked", async () => {
    const createCustomerPortal = mock(async () => "https://portal.example.com");
    const openWindow = mock(() => null);

    await expect(
      openCustomerPortal({
        createCustomerPortal,
        openWindow,
      })
    ).rejects.toThrow("Could not open portal");
  });

  test("does not use fetch internally", async () => {
    const fetchMock = mock();
    globalThis.fetch = fetchMock as typeof fetch;

    await openCustomerPortal({
      createCustomerPortal: async () => "https://portal.example.com",
      openWindow: () => ({ closed: false }),
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
