import { describe, expect, mock, test } from "bun:test";
import { type CheckoutTab, openCheckoutInNewTab } from "@/lib/checkout-tab";

const CHECKOUT_URL = "https://sandbox.polar.sh/checkout/polar_c_123";

const fakeTab = () => {
  const tab: CheckoutTab & { closed: boolean } = {
    closed: false,
    close: () => {
      tab.closed = true;
    },
    location: { href: "about:blank" },
    opener: "settings window",
  };
  return tab;
};

describe("openCheckoutInNewTab", () => {
  test("opens the tab before the checkout URL is requested, then points it at checkout", async () => {
    const tab = fakeTab();
    const events: string[] = [];
    const result = await openCheckoutInNewTab({
      assign: () => events.push("assign"),
      createCheckoutUrl: () => {
        events.push("create");
        return Promise.resolve(CHECKOUT_URL);
      },
      openWindow: (url, target) => {
        events.push(`open ${url || "blank"} ${target}`);
        return tab;
      },
    });

    expect(result).toBe("new-tab");
    expect(events).toEqual(["open blank _blank", "create"]);
    expect(tab.location.href).toBe(CHECKOUT_URL);
    expect(tab.opener).toBeNull();
    expect(tab.closed).toBe(false);
  });

  test("closes the tab when checkout can't start", async () => {
    const tab = fakeTab();
    await expect(
      openCheckoutInNewTab({
        assign: mock(),
        createCheckoutUrl: () => Promise.reject(new Error("Invalid product")),
        openWindow: () => tab,
      })
    ).rejects.toThrow("Invalid product");
    expect(tab.closed).toBe(true);
    expect(tab.location.href).toBe("about:blank");
  });

  test("refuses a checkout URL that isn't http(s)", async () => {
    const tab = fakeTab();
    await expect(
      openCheckoutInNewTab({
        assign: mock(),
        createCheckoutUrl: () => Promise.resolve("javascript:alert(1)"),
        openWindow: () => tab,
      })
    ).rejects.toThrow("Invalid checkout URL");
    expect(tab.closed).toBe(true);
    expect(tab.location.href).toBe("about:blank");
  });

  test("opens checkout in this tab when the browser blocks the new one", async () => {
    const assign = mock();
    const result = await openCheckoutInNewTab({
      assign,
      createCheckoutUrl: () => Promise.resolve(CHECKOUT_URL),
      openWindow: () => null,
    });

    expect(result).toBe("same-tab");
    expect(assign).toHaveBeenCalledWith(CHECKOUT_URL);
  });
});
