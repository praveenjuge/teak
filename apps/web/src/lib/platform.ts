interface NavigatorLike {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
}

const APPLE_PLATFORM = /mac|iphone|ipad|ipod/i;

export function isApplePlatform(
  nav: NavigatorLike | undefined = typeof navigator === "undefined"
    ? undefined
    : (navigator as NavigatorLike)
): boolean {
  if (!nav) {
    return false;
  }
  const platform =
    nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return APPLE_PLATFORM.test(platform);
}

/**
 * Whether the shortcut key ("Mod") is held: ⌘ on Apple platforms and Ctrl
 * elsewhere, with the other one up. Every Mod shortcut reads this, so what
 * a key does always matches the ⌘ or Ctrl its hint and
 * `aria-keyshortcuts` name; Ctrl on a Mac or the Windows key elsewhere is
 * not the shortcut key.
 */
export function isModKey(
  event: { ctrlKey: boolean; metaKey: boolean },
  apple = isApplePlatform()
): boolean {
  return apple
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}
