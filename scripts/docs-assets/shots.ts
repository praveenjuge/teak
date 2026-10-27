/**
 * Every image in the docs, in one list. `bun scripts/docs-assets/capture.ts`
 * captures the `web` shots from the local app; `bun scripts/docs-assets/render.ts`
 * frames every shot on the meadow and writes it to `apps/docs`.
 */

export type MockId =
  | "ai-agents"
  | "api"
  | "architecture"
  | "blog-agent-session"
  | "blog-card-pipeline"
  | "blog-embedding-models"
  | "blog-monorepo"
  | "blog-self-host"
  | "blog-timeline"
  | "adding-a-feature"
  | "cli"
  | "development"
  | "extension"
  | "mcp"
  | "save-by-email"
  | "sdk"
  | "self-hosting"
  | "testing"
  | "webmcp";

interface ShotBase {
  /** The image's alt text, also used as its Markdown alt. */
  alt: string;
  /**
   * Two pastel colors for a diagonal gradient that replaces the meadow behind
   * the window. Blog images use one each, so the covers don't all look alike.
   */
  backdrop?: [string, string];
  /** Output file name, without extension. */
  name: string;
  /** Where the image is written, relative to the repository root. */
  out?: string;
}

/** A capture of the real web app, signed in as the stack's seeded account. */
export interface WebShot extends ShotBase {
  kind: "web";
  /**
   * `window` shows the whole app window; `focus` lifts one part of it (a
   * dialog or a section) onto the meadow on its own; `raw` writes the bare
   * capture, for the home page, which draws its own meadow behind it.
   */
  layout: "focus" | "raw" | "window";
}

/** An HTML mock or diagram from `mocks.ts`, drawn in Teak's own type and colors. */
export interface MockShot extends ShotBase {
  kind: "mock";
  mock: MockId;
}

export type Shot = MockShot | WebShot;

export const DOCS_IMAGES = "apps/docs/content/docs/images";
export const HOME_SHOWCASE = "apps/docs/public/home-showcase";
export const BLOG_IMAGES = "apps/docs/content/blog/images";

export const SHOTS: Shot[] = [
  {
    name: "library",
    kind: "web",
    layout: "window",
    alt: "A Teak library with photos, color palettes, quotes, notes, links and a voice memo, with the sidebar's Everything, Favorites, Tags, Archive, Trash and Settings",
  },
  {
    name: "search",
    kind: "web",
    layout: "window",
    alt: 'Searching "architecture" finds buildings, stairs and interiors by their AI tags, and saved links by their words',
  },
  {
    name: "card-detail",
    kind: "web",
    layout: "focus",
    alt: "An open image card with its AI summary, tags, extracted colors and details",
  },
  {
    name: "command-palette",
    kind: "web",
    layout: "window",
    alt: "The command palette, with Navigate, Actions and their keyboard shortcuts",
  },
  {
    name: "card-types",
    kind: "web",
    layout: "focus",
    alt: "Cards of every type side by side: a note, photos, palettes, quotes, links, a voice memo and a PDF",
  },
  {
    name: "reader",
    kind: "web",
    layout: "focus",
    alt: "A saved Wikipedia article open on Read, its text in one calm layout beside the card's notes, highlights and details",
  },
  {
    name: "highlights",
    kind: "web",
    layout: "focus",
    alt: "A highlighted passage in Read, with the card's details listing its highlights",
  },
  {
    name: "view-menu",
    kind: "web",
    layout: "window",
    alt: "The View menu open beside the search box, with card types, sort order, Shuffle, Revisit and Save as smart folder",
  },
  {
    name: "folder",
    kind: "web",
    layout: "window",
    alt: "A folder of architecture and interior references, with its color and card count in the header",
  },
  {
    name: "tags",
    kind: "web",
    layout: "window",
    alt: "The Tags page listing every tag with how many cards carry it",
  },
  {
    name: "revisit",
    kind: "web",
    layout: "window",
    alt: "Revisit showing one card at a time, with Archive and Keep",
  },
  {
    name: "note-links",
    kind: "web",
    layout: "focus",
    alt: "A note linking two cards, each shown as a pill with the card's type and title",
  },
  {
    name: "note-table",
    kind: "web",
    layout: "focus",
    alt: "A note with a type scale table: style, size, line height and tracking",
  },
  {
    name: "link-details",
    kind: "web",
    layout: "focus",
    alt: "A Wikipedia link's details: its description, when it was last edited, and the saved copy of the page",
  },
  {
    name: "save-by-email",
    kind: "mock",
    mock: "save-by-email",
    alt: "An email forwarded to save@in.teakvault.com, and the link card and attachment it became in Teak",
  },
  {
    name: "settings-account",
    kind: "web",
    layout: "window",
    alt: "Settings → Account, with the plan, appearance, integrations, security and import summaries",
  },
  {
    name: "import",
    kind: "web",
    layout: "window",
    alt: "Settings → Import & export with the import source menu open: browser bookmarks, CSV, a text file of links, Pocket, Raindrop and more",
  },
  {
    name: "export",
    kind: "web",
    layout: "window",
    alt: "Settings → Import & export, with the Start export button in the Export section",
  },
  {
    name: "connected-apps",
    kind: "web",
    layout: "window",
    alt: "Settings → Security showing signed-in devices and connected apps",
  },
  {
    name: "api-keys",
    kind: "web",
    layout: "window",
    alt: "Settings → Integrations with Save by email, apps and extensions, and an API key",
  },
  {
    name: "language",
    kind: "web",
    layout: "focus",
    alt: "Settings → Appearance with the language menu open, listing Teak's eight languages",
  },
  {
    name: "extension",
    kind: "mock",
    mock: "extension",
    alt: "The Teak browser extension's popup over a web page, saying Saved to Teak, with tags and a note",
  },
  {
    name: "cli",
    kind: "mock",
    mock: "cli",
    alt: "A terminal running teak add and teak search, listing matching cards with their types and tags",
  },
  {
    name: "api",
    kind: "mock",
    mock: "api",
    alt: "A POST /v1/cards request beside its JSON response, and the card it made in Teak",
  },
  {
    name: "sdk",
    kind: "mock",
    mock: "sdk",
    alt: "A TypeScript file using teak-sdk to create a card and search the library",
  },
  {
    name: "mcp",
    kind: "mock",
    mock: "mcp",
    alt: "An AI assistant calling Teak's MCP search tool and answering with matching cards",
  },
  {
    name: "webmcp",
    kind: "mock",
    mock: "webmcp",
    alt: "The Teak web app in a browser, with an agent panel listing the page's seven WebMCP tools",
  },
  {
    name: "ai-agents",
    kind: "mock",
    mock: "ai-agents",
    alt: "AI assistants, ChatGPT, scripts and the terminal reach the same Teak library through MCP, the REST API, the SDK and the CLI",
  },
  {
    name: "architecture",
    kind: "mock",
    mock: "architecture",
    alt: "Teak's apps talk to one Convex backend; the Files Worker processes cards and serves files from R2, and the Email Worker handles save by email",
  },
  {
    name: "adding-a-feature",
    kind: "mock",
    mock: "adding-a-feature",
    alt: "A public API feature moves from the internal function to the HTTP handler, route, OpenAPI, MCP tool, SDK method, CLI command and the parity row",
  },
  {
    name: "self-hosting",
    kind: "mock",
    mock: "self-hosting",
    alt: "A self-hosted Teak: the web app, a Convex deployment, WorkOS AuthKit, the Files Worker with R2 and Workers AI, and optional Polar and Email Worker",
  },
  {
    name: "development",
    kind: "mock",
    mock: "development",
    alt: "A terminal running bun run dev --detach, which prints the app's URL, sign-in and ports, then bun run doctor with its checks",
  },
  {
    name: "testing",
    kind: "mock",
    mock: "testing",
    alt: "Teak's test layers, from pure functions with bun test up to end-to-end journeys with e2e",
  },
];

/** The home page's feature showcase (`apps/docs/components/HomeFeatureShowcase.astro`). */
SHOTS.push(
  {
    name: "library-web",
    kind: "web",
    layout: "raw",
    out: HOME_SHOWCASE,
    alt: "Teak library with photos, palettes, quotes, notes, links and a voice memo, beside the sidebar",
  },
  {
    name: "search-web",
    kind: "web",
    layout: "raw",
    out: HOME_SHOWCASE,
    alt: "Teak search for architecture, showing buildings, stairs and interiors found by their AI tags",
  },
  {
    name: "organize-web",
    kind: "web",
    layout: "raw",
    out: HOME_SHOWCASE,
    alt: "Teak image card with its notes, tags, AI summary and extracted colors",
  },
  {
    name: "import-web",
    kind: "web",
    layout: "raw",
    out: HOME_SHOWCASE,
    alt: "Teak's Import & export settings with the import source picker and Start export",
  },
  {
    name: "connected-apps-web",
    kind: "web",
    layout: "raw",
    out: HOME_SHOWCASE,
    alt: "Teak security settings showing signed-in devices and the connected Teak CLI",
  }
);

/**
 * The blog's images. Each post's cover is named after the post's file and
 * opens the post; posts may also show docs images from `DOCS_IMAGES`.
 */
SHOTS.push(
  {
    name: "why-we-built-teak",
    backdrop: ["#fde2e4", "#fdeedc"],
    kind: "web",
    layout: "window",
    out: BLOG_IMAGES,
    alt: "A Teak library showing only images: buildings, vases, posters, prints and interiors in one grid",
  },
  {
    name: "rediscovering-what-you-saved",
    backdrop: ["#ebe3fc", "#fbe4f0"],
    kind: "web",
    layout: "window",
    out: BLOG_IMAGES,
    alt: "Revisit showing one saved photo at a time, with Archive and Keep below it",
  },
  {
    name: "search-by-meaning",
    backdrop: ["#dce8fb", "#d9f2f7"],
    kind: "web",
    layout: "window",
    out: BLOG_IMAGES,
    alt: 'Searching "japanese prints" finds two woodblock prints, though neither title has either word',
  },
  {
    name: "embedding-models",
    backdrop: ["#e1e6fb", "#e2eefb"],
    kind: "mock",
    mock: "blog-embedding-models",
    out: BLOG_IMAGES,
    alt: "Four embedding models compared on recall and ranking, with embeddinggemma-300m chosen",
  },
  {
    name: "build-a-moodboard-in-teak",
    backdrop: ["#fde9d6", "#fcf3cb"],
    kind: "web",
    layout: "window",
    out: BLOG_IMAGES,
    alt: "The Moodboard smart folder, collecting every image and color palette in the library",
  },
  {
    name: "small-features-in-teak",
    backdrop: ["#d9f2e6", "#e9f5d3"],
    kind: "web",
    layout: "window",
    out: BLOG_IMAGES,
    alt: "The keyboard shortcuts sheet, listing shortcuts for the library, an open card and navigation",
  },
  {
    name: "from-link-to-card",
    backdrop: ["#e3e2fb", "#efe3fb"],
    kind: "mock",
    mock: "blog-card-pipeline",
    out: BLOG_IMAGES,
    alt: "A save goes to Convex, a Files Worker Workflow fetches, describes and archives the card step by step, and the card becomes searchable by meaning",
  },
  {
    name: "one-monorepo-every-platform",
    backdrop: ["#d7f0eb", "#dee9fb"],
    kind: "mock",
    mock: "blog-monorepo",
    out: BLOG_IMAGES,
    alt: "Teak's nine apps, from the web app to the Email Worker, above the five packages they share",
  },
  {
    name: "teak-for-ai-agents",
    backdrop: ["#fbe1ec", "#fde7d8"],
    kind: "mock",
    mock: "blog-agent-session",
    out: BLOG_IMAGES,
    alt: "An AI assistant saving an article to Teak with one MCP tool, then searching the library with another",
  },
  {
    name: "self-hosting-teak",
    backdrop: ["#dbeefb", "#e4e4fb"],
    kind: "mock",
    mock: "blog-self-host",
    out: BLOG_IMAGES,
    alt: "A terminal cloning Teak, starting a Convex deployment, setting its environment and running the web app",
  },
  {
    name: "building-teak-in-public",
    backdrop: ["#fbe0de", "#fdecd3"],
    kind: "mock",
    mock: "blog-timeline",
    out: BLOG_IMAGES,
    alt: "A timeline of Teak from the first commit in August 2025 to native apps and search by meaning in October 2026",
  }
);

/**
 * Pages that need no image. Legal pages stay plain text, the Mac and
 * mobile pages wait for fresh native captures (`scripts/store-assets`), and
 * Raycast shows its store's install button.
 */
export const PAGES_WITHOUT_IMAGES = [
  "(legal)/delete-account.mdx",
  "(legal)/privacy-policy.mdx",
  "(legal)/terms-of-service.mdx",
  "(apps)/mac.mdx",
  "(apps)/mobile.mdx",
  "(apps)/raycast.mdx",
];
