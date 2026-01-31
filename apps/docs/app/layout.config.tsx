import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import Logo from "@/components/Logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
          className={cn(buttonVariants({ variant: "outline" }))}
          href="https://app.teakvault.com/login?redirect_url=https%3A%2F%2Fapp.teakvault.com%2F"
          rel="noopener noreferrer"
          target="_blank"
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
          className={cn(buttonVariants({ variant: "default" }), "ml-2.5")}
          href="https://app.teakvault.com/register"
          rel="noopener noreferrer"
          target="_blank"
        >
          Start Free
        </a>
      ),
      secondary: true,
    },
  ],
  themeSwitch: {
    enabled: false,
  },
};
