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
    dir: "apps/docs",
  },
  content: {
    root: "content",
  },
  deployment: {
    // Keep static hosting (Ask AI needs server output).
    output: "static",
    site: "https://teakvault.com",
  },
  lastModified: true,
  theme: {
    accent: "oklch(0.58 0.22 27)",
  },
  navigation: {
    tabs: [
      { label: "Pricing", path: "/pricing", href: "/pricing" },
      { label: "Apps", path: "/apps", href: "/apps" },
      { label: "Changelog", path: "/changelog", href: "/changelog" },
      { label: "Docs", path: "/docs" },
    ],
  },
  export: true,
  openapi: {
    enabled: true,
    route: "/reference",
    spec: "./.generated/openapi.json",
  },
  search: {
    popular: [
      { label: "Features", href: "/docs/features", icon: "sparkles" },
      { label: "Desktop", href: "/docs/desktop", icon: "monitor" },
      { label: "Mobile", href: "/docs/mobile", icon: "smartphone" },
      {
        label: "Browser extensions",
        href: "/docs/extension",
        icon: "puzzle",
      },
      { label: "API reference", href: "/reference", icon: "code" },
      { label: "Self-hosting", href: "/docs/self-hosting", icon: "server" },
    ],
  },
  seo: {
    x: { handle: "@praveenjuge" },
    rss: {
      enabled: true,
      types: ["changelog"],
    },
    sitemap: true,
    robots: true,
    structuredData: true,
  },
  // Mirrored in vercel.json for Vercel Git HTTP redirects; Astro also emits
  // these as soft redirects for non-Vercel previews and link audits.
  redirects: [
    { from: "/sitemap-index.xml", to: "/sitemap.xml", status: 301 },
    { from: "/llms-small.txt", to: "/llms.txt", status: 301 },
    { from: "/docs/index.md", to: "/docs.md", status: 301 },
  ],
  ai: {
    llmsTxt: true,
  },
  integrations: [teakDevProxy()],
});
