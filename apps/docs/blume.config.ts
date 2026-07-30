import { defineConfig } from "blume";

const devConvexSite =
  process.env.TEAK_DEV_API_URL?.trim() ||
  "https://reminiscent-kangaroo-59.convex.site";

function teakDevProxy() {
  return {
    name: "teak-dev-proxy",
    hooks: {
      "astro:config:setup": ({
        updateConfig,
      }: {
        updateConfig: (config: Record<string, unknown>) => void;
      }) => {
        updateConfig({
          vite: {
            server: {
              proxy: {
                "/api": {
                  target: devConvexSite,
                  changeOrigin: true,
                  rewrite: (path: string) =>
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
        });
      },
    },
  };
}

export default defineConfig({
  title: "Teak",
  description:
    "Teak is a personal knowledge hub for saving, finding, and syncing cards. Use the REST API at https://teakvault.com/api/v1, the MCP server at https://teakvault.com/mcp, and bearer auth with OAuth access tokens or teakapi_ API keys.",
  logo: {
    image: {
      light: "/logos/logo-light.svg",
      dark: "/logos/logo-dark.svg",
      alt: "Teak",
    },
    text: "",
  },
  github: {
    owner: "praveenjuge",
    repo: "teak",
    branch: "main",
    dir: "apps/docs",
  },
  content: {
    root: "content",
    pages: "pages",
  },
  deployment: {
    output: "static",
    site: "https://teakvault.com",
  },
  lastModified: true,
  theme: {
    accent: "oklch(0.58 0.22 27)",
    radius: "md",
    mode: "system",
  },
  banner: {
    content:
      "Desktop, Safari, CLI, and browser sign-in for API and MCP are available.",
    link: { text: "See apps", href: "/apps" },
    dismissible: true,
    id: "apps-surface-2026",
  },
  navigation: {
    sidebar: { display: "group" },
    tabs: [
      { label: "Docs", path: "/docs" },
      { label: "Apps", path: "/apps", href: "/apps" },
      { label: "Pricing", path: "/pricing", href: "/pricing" },
      { label: "Changelog", path: "/changelog", href: "/changelog" },
      { label: "API Reference", path: "/reference" },
    ],
  },
  // Stay static: Ask AI and Blume docs MCP need server output or an external
  // Ask endpoint. Product Teak MCP stays at /mcp via Vercel rewrite — if you
  // enable Blume's docs MCP later, mount it at /docs-mcp only. See
  // content/docs/(developers)/development.mdx.
  export: true,
  openapi: {
    enabled: true,
    route: "/reference",
    spec: "./openapi.json",
    codeSamples: ["curl", "js"],
  },
  markdown: {
    code: {
      icons: true,
    },
  },
  seo: {
    rss: {
      enabled: true,
      types: ["changelog"],
    },
    x: { handle: "@praveenjuge" },
  },
  integrations: [teakDevProxy()],
});
