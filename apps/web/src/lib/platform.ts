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

export function getPrimaryModifierLabel(nav?: NavigatorLike): "Cmd" | "Ctrl" {
  return (nav ? isApplePlatform(nav) : isApplePlatform()) ? "Cmd" : "Ctrl";
}
