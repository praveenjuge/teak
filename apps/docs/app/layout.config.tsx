import { buttonVariants } from "@teak/ui/components/ui/button";
import { cn } from "@teak/ui/lib/utils";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import Logo from "@/components/Logo";

/**
 * Shared layout configurations
 *
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
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
    {
      text: "Apps",
      url: "/apps",
    },
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
