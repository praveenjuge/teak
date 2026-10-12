interface NavigatorLike {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
}

const APPLE_PLATFORM = /mac|iphone|ipad|ipod/i;

/** True on macOS and iOS, where shortcuts use Cmd instead of Ctrl. */
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

/** "Cmd" on Apple platforms, "Ctrl" everywhere else. */
export function getPrimaryModifierLabel(nav?: NavigatorLike): "Cmd" | "Ctrl" {
  return (nav ? isApplePlatform(nav) : isApplePlatform()) ? "Cmd" : "Ctrl";
}
