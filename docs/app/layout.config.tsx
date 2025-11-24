import Logo from "@/components/Logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

/**
 * Shared layout configurations
 *
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
const appsPageEnabled =
  process.env.NEXT_PUBLIC_ENABLE_APPS_PAGE?.toLowerCase() === "true";

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: <Logo variant="primary" />,
    transparentMode: "always",
  },
  // see https://fumadocs.dev/docs/ui/navigation/links
  links: [
    {
      text: "Pricing",
      url: "/pricing",
    },
    ...(appsPageEnabled
      ? [
          {
            text: "Apps",
            url: "/apps",
          },
        ]
      : []),
    {
      text: "Changelog",
      url: "/changelog",
    },
    {
      text: "Docs",
      url: "/docs",
    },
    {
      type: "custom",
      children: (
        <a
          href="https://app.teakvault.com/login?redirect_url=https%3A%2F%2Fapp.teakvault.com%2F"
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Login
        </a>
      ),
      secondary: true,
    },
    {
      type: "custom",
      children: (
        <a
          href="https://accounts.teakvault.com/waitlist"
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: "default" }), "ml-2.5")}
        >
          Join Waitlist →
        </a>
      ),
      secondary: true,
    },
  ],
  themeSwitch: {
    enabled: false,
  },
};
