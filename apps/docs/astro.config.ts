import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://teakvault.com",
  output: "static",
  integrations: [
    starlight({
      title: "Teak",
      logo: {
        dark: "./src/assets/logo-dark.svg",
        light: "./src/assets/logo-light.svg",
        replacesTitle: true,
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/praveenjuge/teak",
        },
        {
          icon: "x.com",
          label: "X",
          href: "https://x.com/praveenjuge",
        },
      ],
      customCss: ["./src/styles/starlight.css"],
      sidebar: [
        { label: "Welcome to Teak", slug: "docs" },
        { label: "Features", slug: "docs/features" },
        { label: "Desktop App (macOS)", slug: "docs/desktop" },
        { label: "Mobile App (iOS)", slug: "docs/mobile" },
        { label: "Browser Extension", slug: "docs/extension" },
        { label: "Raycast Extension", slug: "docs/raycast" },
        { label: "API", slug: "docs/api" },
        { label: "MCP", slug: "docs/mcp" },
        { label: "Development Guide", slug: "docs/development" },
        { label: "Self-Hosting", slug: "docs/self-hosting" },
        { label: "Privacy Policy", slug: "docs/privacy-policy" },
        { label: "Terms of Service", slug: "docs/terms-of-service" },
        { label: "Support", slug: "docs/support" },
      ],
      head: [
        {
          tag: "meta",
          attrs: {
            property: "og:image",
            content: "/hero-image.png",
          },
        },
        {
          tag: "meta",
          attrs: {
            name: "twitter:card",
            content: "summary_large_image",
          },
        },
      ],
      editLink: {
        baseUrl: "https://github.com/praveenjuge/teak/edit/main/apps/docs/",
      },
    }),
    sitemap({
      filter: (page) => !page.includes("/404"),
    }),
  ],
  vite: {
    plugins: [tailwindcss() as any],
  },
  redirects: {
    "/docs/environment-settings": "/docs/self-hosting#environment-settings",
  },
  security: {
    csp: true,
  },
  experimental: {
    queuedRendering: {
      enabled: true,
    },
  },
});
