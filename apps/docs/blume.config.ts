import { DEFAULT_TEAK_DEV_API_URL } from "@teak/convex/devUrls";
import {
  ORGANIZATION_LOGO,
  ORGANIZATION_SAME_AS,
} from "@teak/convex/shared/organization";
import { defineConfig } from "blume";
import { openapi } from "blume/reference";

const devConvexSite =
  process.env.TEAK_DEV_API_URL?.trim() || DEFAULT_TEAK_DEV_API_URL;

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

// Allo by Josh Puckett (SIL OFL 1.1, public/fonts/Allo-OFL.txt). The upright
// face is variable; italics use Allo's drawn obliques, as in the web app.
const ALLO = {
  name: "Allo",
  variants: [
    {
      src: "./public/fonts/AlloVariableFriendly.woff2",
      weight: "100..900",
      style: "normal",
    },
    { src: "./public/fonts/Allo-Oblique.woff2", weight: 400, style: "italic" },
    {
      src: "./public/fonts/Allo-MediumOblique.woff2",
      weight: 500,
      style: "italic",
    },
    {
      src: "./public/fonts/Allo-SemiBoldOblique.woff2",
      weight: 600,
      style: "italic",
    },
    {
      src: "./public/fonts/Allo-BoldOblique.woff2",
      weight: 700,
      style: "italic",
    },
  ],
} as const;

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
    site: "https://teakvault.com",
  },
  lastModified: "git",
  theme: {
    accent: "oklch(0.58 0.22 27)",
    fonts: {
      display: ALLO,
      body: ALLO,
    },
  },
  footer: {
    links: [
      { label: "Blog", href: "/blog" },
      { label: "Privacy", href: "/docs/privacy-policy" },
      { label: "Terms", href: "/docs/terms-of-service" },
    ],
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
  // Written as {{name}} in content; values must stay one plain-text line.
  variables: {
    "api-url": "https://teakvault.com/api/v1",
    "mcp-url": "https://teakvault.com/mcp",
  },
  reference: [
    openapi({
      route: "/reference",
      spec: "./.generated/openapi.json",
      codeSamples: ["curl", "js", "typescript", "python", "go", "ruby", "php"],
    }),
  ],
  search: {
    popular: [
      { label: "Features", href: "/docs/features", icon: "sparkles" },
      {
        label: "Browser extensions",
        href: "/docs/extension",
        icon: "puzzle",
      },
      { label: "Mobile", href: "/docs/mobile", icon: "smartphone" },
      { label: "Mac", href: "/docs/mac", icon: "monitor" },
      { label: "Import", href: "/docs/import", icon: "download" },
      { label: "Export", href: "/docs/export", icon: "upload" },
    ],
  },
  seo: {
    og: {
      logo: "/logos/logo-light.svg",
      titles: { "/blog": "The Teak Blog" },
      palette: {
        accent: "#df2225",
        background: "#ffffff",
        foreground: "#030712",
        muted: "#6a7282",
        border: "#e5e7eb",
      },
    },
    x: { handle: "@praveenjuge" },
    rss: {
      enabled: true,
      types: ["changelog", "blog"],
    },
    sitemap: true,
    // public/robots.txt replaces Blume's allow-all file: it also keeps
    // crawlers off the Core Worker's signed-in API and MCP routes, which the
    // API reference's code samples print as plain URLs.
    robots: false,
    structuredData: true,
    organization: {
      logo: ORGANIZATION_LOGO,
      sameAs: ORGANIZATION_SAME_AS,
    },
  },
  redirects: [
    { from: "/docs/desktop", to: "/docs/mac", status: 301 },
    { from: "/sitemap-index.xml", to: "/sitemap.xml", status: 301 },
    { from: "/llms-small.txt", to: "/llms.txt", status: 301 },
    { from: "/docs/index.md", to: "/docs.md", status: 301 },
    { from: "/docs/skills", to: "/docs/ai-agents", status: 301 },
    { from: "/changelog/09-*", to: "/changelog/september-2026", status: 301 },
  ],
  markdown: {
    externalLinks: true,
  },
  ai: {
    openInChat: ["claude", "chatgpt", "cursor"],
  },
  agents: {
    skills: "./.generated/agent-skills",
    llmsTxt: {
      details: [
        "## When to use Teak",
        "",
        "Use Teak when a person wants to keep knowledge beyond the current conversation: save a link or note, retrieve something collected earlier, organize research with tags, or sync the same private library across apps and agents. Use the MCP server for assistant workflows, the REST API for an integration, and the CLI for local scripts. Do not use Teak as a temporary scratchpad when the information does not need to persist.",
      ].join("\n"),
    },
  },
  integrations: [teakDevProxy()],
});
