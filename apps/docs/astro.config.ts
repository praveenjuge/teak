import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, fontProviders } from "astro/config";
import starlightLlmsTxt from "starlight-llms-txt";

const devConvexSite =
  process.env.TEAK_DEV_API_URL?.trim() ||
  "https://reminiscent-kangaroo-59.convex.site";

export default defineConfig({
  site: "https://teakvault.com",
  output: "static",
  fonts: [
    {
      provider: fontProviders.local(),
      name: "SN Pro",
      cssVariable: "--font-sn-pro",
      options: {
        variants: [
          {
            weight: "200 900",
            style: "normal",
            src: [
              "./src/assets/fonts/SNPro-VariableRegular.woff2",
              "./src/assets/fonts/SNPro-VariableRegular.woff",
            ],
          },
          {
            weight: "200 900",
            style: "italic",
            src: ["./src/assets/fonts/SNPro-VariableItalic.woff2"],
          },
        ],
      },
    },
  ],
  integrations: [
    starlight({
      title: "Teak",
      lastUpdated: true,
      expressiveCode: {
        themes: ["github-dark-default", "github-light-default"],
        styleOverrides: {
          borderRadius: "0.5rem",
        },
      },
      components: {
        Head: "./src/components/StarlightHead.astro",
        PageTitle: "./src/components/StarlightPageTitle.astro",
      },
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
      plugins: [
        starlightLlmsTxt({
          projectName: "Teak",
          description:
            "Teak is a personal knowledge hub for saving, finding, and syncing cards. Use the REST API at https://teakvault.com/api/v1, the MCP server at https://teakvault.com/mcp, and bearer auth with OAuth access tokens or teakapi_ API keys.",
          details:
            "Integration essentials: API discovery is available at https://teakvault.com/api, OpenAPI is at https://teakvault.com/api/openapi.json, MCP OAuth protected-resource metadata is at https://teakvault.com/.well-known/oauth-protected-resource/mcp, and legacy https://api.teakvault.com URLs continue to work.",
          promote: ["docs/ai-agents", "docs/api", "docs/mcp", "docs/cli"],
        }),
      ],
      sidebar: [
        { label: "Welcome to Teak", slug: "docs" },
        { label: "Features", slug: "docs/features" },
        {
          label: "Apps",
          items: [
            { label: "Desktop App (macOS)", slug: "docs/desktop" },
            { label: "Mobile App (iOS)", slug: "docs/mobile" },
            { label: "Browser Extension", slug: "docs/extension" },
            { label: "Raycast Extension", slug: "docs/raycast" },
            { label: "Command Line", slug: "docs/cli" },
          ],
        },
        {
          label: "Data",
          items: [
            { label: "Import", slug: "docs/import" },
            { label: "Export", slug: "docs/export" },
          ],
        },
        {
          label: "Developers",
          items: [
            { label: "API", slug: "docs/api" },
            { label: "MCP", slug: "docs/mcp" },
            { label: "Teak for AI Agents", slug: "docs/ai-agents" },
            { label: "Agent Skill", slug: "docs/skills" },
            { label: "Development Guide", slug: "docs/development" },
            {
              label: "Self-Hosting",
              slug: "docs/self-hosting",
              badge: { text: "Beta", variant: "caution" },
            },
          ],
        },
        {
          label: "Legal & Support",
          items: [
            { label: "Privacy Policy", slug: "docs/privacy-policy" },
            { label: "Terms of Service", slug: "docs/terms-of-service" },
            { label: "Support", slug: "docs/support" },
          ],
        },
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
    server: {
      proxy: {
        "/api": {
          target: devConvexSite,
          changeOrigin: true,
          rewrite: (path) =>
            path === "/api" ? "/v1" : path.replace(/^\/api/, ""),
        },
        "/mcp": {
          target: devConvexSite,
          changeOrigin: true,
        },
        "/.well-known/oauth-protected-resource": {
          target: devConvexSite,
          changeOrigin: true,
        },
      },
    },
  },
  security: {
    csp: true,
  },
});
