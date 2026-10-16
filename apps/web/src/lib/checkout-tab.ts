import { sanitizeExternalUrl } from "@teak/convex/shared/utils/safeUrl";

export interface CheckoutTab {
  close: () => void;
  location: { href: string };
  opener: unknown;
}

export interface ReservedCheckoutTab {
  navigate: (
    createCheckoutUrl: () => Promise<string>
  ) => Promise<"new-tab" | "same-tab">;
}

/**
 * Opens a blank tab for Polar checkout, which refuses to be framed. Call it
 * inside the click: browsers block `window.open` after an awaited call, so
 * the tab is opened before the checkout URL exists. `navigate` points it at
 * checkout, closes it if checkout can't start, and uses this tab when the
 * browser blocked the new one anyway.
 */
export function reserveCheckoutTab({
  assign,
  openWindow,
}: {
  assign: (url: string) => void;
  openWindow: (url: string, target: string) => CheckoutTab | null;
}): ReservedCheckoutTab {
  const tab = openWindow("", "_blank");
  if (tab) {
    // The blank tab is same-origin until it navigates; cut its way back.
    tab.opener = null;
  }

  return {
    navigate: async (createCheckoutUrl) => {
      let checkoutUrl: string;
      try {
        const safeUrl = sanitizeExternalUrl(await createCheckoutUrl());
        if (!safeUrl) {
          throw new Error("Invalid checkout URL");
        }
        checkoutUrl = safeUrl;
      } catch (error) {
        tab?.close();
        throw error;
      }

      if (!tab) {
        assign(checkoutUrl);
        return "same-tab";
      }
      tab.location.href = checkoutUrl;
      return "new-tab";
    },
  };
}
