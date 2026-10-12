import { sanitizeExternalUrl } from "@teak/convex/shared/utils/safeUrl";

export interface CheckoutTab {
  close: () => void;
  location: { href: string };
  opener: unknown;
}

interface OpenCheckoutInNewTabOptions {
  /** Navigates this tab, for when the browser blocks the new one. */
  assign: (url: string) => void;
  createCheckoutUrl: () => Promise<string>;
  openWindow: (url: string, target: string) => CheckoutTab | null;
}

/**
 * Opens Polar checkout in a new tab. Polar refuses to be framed, so checkout
 * can't be embedded. The tab opens before the checkout URL exists, while the
 * click that started checkout still counts as a user gesture: browsers block
 * `window.open` after an awaited call. It's pointed at checkout once the URL
 * arrives, and closed again if checkout can't start. When the browser blocks
 * the tab anyway, checkout opens in this tab instead.
 */
export async function openCheckoutInNewTab({
  assign,
  createCheckoutUrl,
  openWindow,
}: OpenCheckoutInNewTabOptions): Promise<"new-tab" | "same-tab"> {
  const tab = openWindow("", "_blank");
  if (tab) {
    // The blank tab is same-origin until it navigates; cut its way back.
    tab.opener = null;
  }

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
}
