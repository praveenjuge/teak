import { defineConfig } from "blume";
import { openapi } from "blume/reference";
import { ORGANIZATION_LOGO, ORGANIZATION_SAME_AS } from "./lib/jsonld";

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

const SN_PRO = {
  name: "SN Pro",
  variants: [
    {
      src: "./public/fonts/SNPro-VariableRegular.woff2",
      weight: "200..900",
      style: "normal",
    },
    {
      src: "./public/fonts/SNPro-VariableItalic.woff2",
      weight: "200..900",
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
    // Keep static hosting (Ask AI needs server output).
    site: "https://teakvault.com",
  },
  lastModified: "git",
  theme: {
    accent: "oklch(0.58 0.22 27)",
    // Local files also give the generated Open Graph cards the brand font.
    fonts: {
      display: SN_PRO,
      body: SN_PRO,
    },
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
    x: { handle: "@praveenjuge" },
    rss: {
      enabled: true,
      types: ["changelog"],
    },
    sitemap: true,
    robots: true,
    structuredData: true,
    organization: {
      logo: ORGANIZATION_LOGO,
      sameAs: ORGANIZATION_SAME_AS,
    },
  },
  // Mirrored in vercel.json for Vercel Git HTTP redirects; Astro also emits
  // these as soft redirects for non-Vercel previews and link audits.
  // Blume moves a page's .md and .mdx mirrors with each page redirect.
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
    // Public skills copied by scripts/generate-skills.ts.
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
