export const docsNavItems = [
  { title: "Welcome to Teak", href: "/docs", icon: "BookOpen" },
  { title: "Features", href: "/docs/features", icon: "Sparkles" },
  { title: "Desktop App (macOS)", href: "/docs/desktop", icon: "Monitor" },
  { title: "Mobile App (iOS)", href: "/docs/mobile", icon: "Smartphone" },
  { title: "Browser Extension", href: "/docs/extension", icon: "Puzzle" },
  { title: "Raycast Extension", href: "/docs/raycast", icon: "Command" },
  { title: "API", href: "/docs/api", icon: "Braces" },
  { title: "MCP", href: "/docs/mcp", icon: "Bot" },
  { title: "Development Guide", href: "/docs/development", icon: "Wrench" },
  { title: "Self-Hosting", href: "/docs/self-hosting", icon: "Server" },
  { title: "Privacy Policy", href: "/docs/privacy-policy", icon: "Shield" },
  {
    title: "Terms of Service",
    href: "/docs/terms-of-service",
    icon: "ScrollText",
  },
  { title: "Support", href: "/docs/support", icon: "LifeBuoy" },
] as const;

export function isDocsNavItemActive(
  href: string,
  currentPath: string
): boolean {
  const normalized = currentPath.replace(/\/$/, "") || "/";
  const normalizedHref = href.replace(/\/$/, "") || "/";
  return normalized === normalizedHref;
}
