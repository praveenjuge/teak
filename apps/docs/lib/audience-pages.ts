import { buildPageSchemas, SITE_URL } from "./jsonld";
import { FREE_CARD_LIMIT } from "./pricing";

export const AUDIENCE_SLUGS = [
  "designers",
  "developers",
  "researchers",
  "save-without-filing",
] as const;

export type AudienceSlug = (typeof AUDIENCE_SLUGS)[number];

export interface AudienceFeature {
  description: string;
  /** A Lucide icon name, rendered decoratively by blume's Icon. */
  icon: string;
  title: string;
}

export interface AudienceFaq {
  answer: string;
  question: string;
}

export interface AudiencePage {
  demoCardIds: string[];
  /** Meta description, 160 characters or fewer. */
  description: string;
  faqs: AudienceFaq[];
  features: AudienceFeature[];
  featuresTitle: string;
  guide: { href: string; label: string };
  h1: string;
  intro: string;
  navLabel: string;
  slug: AudienceSlug;
  summary: string;
  /** Meta title without the " | Teak" suffix the layout adds. */
  title: string;
}

export const AUDIENCE_PAGES: Record<AudienceSlug, AudiencePage> = {
  designers: {
    slug: "designers",
    navLabel: "Designers",
    summary: "Find references by color, style, mood or the words inside them.",
    title: "Teak for designers: find references by how they look",
    description:
      "Save screenshots, links, photos and palettes, then find them by color, style, mood or the words inside them. One calm library for every reference.",
    h1: "Find the reference by how it looks.",
    intro:
      "Save screenshots, links, photos and palettes from anywhere. Teak reads their colors, style and text, so you can find them by whatever you remember.",
    featuresTitle: "Built around how references look",
    features: [
      {
        icon: "palette",
        title: "Search by color and style",
        description:
          "Type a color name, a hex code like `#3B82F6`, or a style like `minimal`, `dark` or `hand-drawn` to find images and videos with that look.",
      },
      {
        icon: "sparkles",
        title: "Search by mood",
        description:
          '`mood:"moody brutalist"` lists the images whose look, description and tags match your words.',
      },
      {
        icon: "layers",
        title: "More like this",
        description:
          "Open a card and choose More like this to see the cards closest to it in meaning: notes, links and images about the same thing.",
      },
      {
        icon: "scan-text",
        title: "Screenshots you can search",
        description:
          "Teak reads the words in images, so search finds a screenshot by a line of its copy. Use `text:` to search only those words.",
      },
      {
        icon: "folders",
        title: "Boards in folders",
        description:
          "Group references by project in colored folders. A card can sit in several at once, and smart folders fill themselves from a search.",
      },
      {
        icon: "pipette",
        title: "Palettes from every image",
        description:
          "Teak pulls the dominant colors out of each image and video, and a list of hex codes you save becomes its own palette card.",
      },
    ],
    demoCardIds: [
      "building",
      "harbor",
      "desk",
      "flower",
      "inter",
      "terracotta",
      "camera",
      "hangers",
      "signal",
      "jacket",
      "type-scale",
      "laptop-flatlay",
      "vignelli",
      "northwind",
      "rams",
      "nng",
      "spacing",
      "kickoff-memo",
    ],
    faqs: [
      {
        question: "Can I search my images by color?",
        answer:
          "Yes. Type a color name like `teal`, or an exact hex code like `#3B82F6`, and Teak shows the images and videos whose dominant colors match. Add a style such as `minimal` or `cinematic` to narrow it.",
      },
      {
        question: "What does mood search do?",
        answer:
          '`mood:"moody brutalist"` lists images whose look matches your words, using their description, tags, visual style and any text in them. It only searches images.',
      },
      {
        question: "Does Teak read the text in my screenshots?",
        answer:
          "Yes. Teak reads the words in images when you save them, so search finds a screenshot by its text. Teak uses those words only to find your cards and doesn't show them.",
      },
      {
        question: "What can I save?",
        answer:
          "Images, videos, links, notes, quotes, palettes, audio and documents, including PDFs and design files, up to 100 MB each.",
      },
    ],
    guide: {
      href: "/docs/features#smart-search",
      label: "See every search filter",
    },
  },
  developers: {
    slug: "developers",
    navLabel: "Developers",
    summary: "Reach your library from the API, MCP, CLI, SDK and Raycast.",
    title: "Teak for developers: API, MCP, CLI and SDK",
    description:
      "Save links, snippets and notes, then reach them from your terminal, scripts and agents through Teak's REST API, MCP server, CLI and SDK.",
    h1: "Your references, one command away.",
    intro:
      "Save links, snippets and notes as you work. Search them from the terminal, script them with the API, or hand them to your agents over MCP.",
    featuresTitle: "Every way into your library",
    features: [
      {
        icon: "braces",
        title: "REST API",
        description:
          "Create, search, update and export cards over HTTPS with an API key or OAuth. Every endpoint is in the OpenAPI reference.",
      },
      {
        icon: "bot",
        title: "MCP server",
        description:
          "Connect an assistant to the remote MCP server, and it can save, search and organize cards for you.",
      },
      {
        icon: "square-terminal",
        title: "CLI and SDK",
        description:
          "Save from standard input, then search, tag and export with the `teak` command, or build on the same calls with the SDK.",
      },
      {
        icon: "command",
        title: "Raycast",
        description:
          "Save and search without leaving the keyboard, with search filters and AI tools in the Teak extension for Raycast.",
      },
      {
        icon: "search",
        title: "Search qualifiers",
        description:
          "Narrow any search with `type:`, `site:`, `tag:`, `folder:` and `is:todo`, in the web app, the command palette and the browser extension's address bar.",
      },
      {
        icon: "file-code",
        title: "Markdown notes and code",
        description:
          "Notes are Markdown, and a snippet saved from the CLI or API is stored exactly as you sent it. Search reads the text of the source files you upload.",
      },
    ],
    demoCardIds: [
      "refactoring-ui",
      "type-scale",
      "laws-of-ux",
      "onboarding-critique",
      "spacing",
      "nng",
      "signal",
      "northwind",
      "inter",
      "rams",
      "kickoff-memo",
      "laptop-flatlay",
      "harbor",
      "vignelli",
      "desk",
      "camera",
      "terracotta",
      "building",
    ],
    faqs: [
      {
        question: "How do I authenticate?",
        answer:
          "Sign in with your browser, or create a long-lived key under Settings → Security → API keys. The API and MCP server accept OAuth access tokens and `teakapi_` keys as bearer tokens.",
      },
      {
        question: "Are the API, MCP and CLI on the free plan?",
        answer:
          "Yes. The API, MCP server and CLI work on every plan, including Free.",
      },
      {
        question: "Can agents use Teak?",
        answer:
          "Yes. Connect an MCP client to the remote MCP server, or install the public agent skill, which teaches an agent when to use the CLI, API, SDK or MCP.",
      },
      {
        question: "Can I keep a local copy of my library?",
        answer:
          "Yes. Export everything, with original files, as a ZIP from Settings in the web app or with the CLI, whenever you like.",
      },
    ],
    guide: { href: "/docs/api-quickstart", label: "Read the API quickstart" },
  },
  researchers: {
    slug: "researchers",
    navLabel: "Researchers and writers",
    summary: "Search PDFs, transcripts and notes down to the sentence.",
    title: "Teak for researchers and writers: keep every source",
    description:
      "Save PDFs, articles, recordings and quotes. Teak reads the text inside them, so search finds the line you remember, and your notes link to each other.",
    h1: "Every source, searchable to the sentence.",
    intro:
      "Save papers, articles, recordings and passages as you read. Teak reads the text inside them, so you can find a source by the line you remember.",
    featuresTitle: "From source to draft",
    features: [
      {
        icon: "file-text",
        title: "PDFs you can search",
        description:
          "Teak reads the text of PDFs, Word and PowerPoint files when you save them, and the first pages of scanned PDFs, so search finds a document by a sentence in it.",
      },
      {
        icon: "audio-lines",
        title: "Transcripts of what was said",
        description:
          "Teak transcribes the voice memos and videos you save, and many podcast episodes you link to, so search finds a phrase someone said.",
      },
      {
        icon: "link",
        title: "Notes that link",
        description:
          "Type `[[` in a note to link another card. Open any card to see the notes that link to it.",
      },
      {
        icon: "quote",
        title: "Quotes that keep their source",
        description:
          "Text you save from a page with the browser extension keeps the page it came from, and a quotation with who said it becomes a quote card.",
      },
      {
        icon: "book-open-check",
        title: "Read, then mark it done",
        description:
          "Mark articles, books and papers as read when you finish them. Search `is:todo` to see what's left on your list.",
      },
      {
        icon: "maximize-2",
        title: "Write in focus",
        description:
          "Press `⌘E` to write in one quiet column with a word count. An existing note saves on its own as you type.",
      },
    ],
    demoCardIds: [
      "northwind",
      "kickoff-memo",
      "nng",
      "vignelli",
      "onboarding-critique",
      "laws-of-ux",
      "rams",
      "refactoring-ui",
      "building",
      "type-scale",
      "camera",
      "inter",
      "desk",
      "harbor",
      "flower",
      "spacing",
      "jacket",
      "laptop-flatlay",
    ],
    faqs: [
      {
        question: "Can Teak search inside my PDFs?",
        answer:
          "Yes. Teak reads the text of PDFs when you save them, so search finds a document by a sentence in it. A scanned PDF without a text layer is read too, from its first 3 pages.",
      },
      {
        question: "Can I search what was said in a recording?",
        answer:
          "Yes. Teak transcribes the audio and video you save, so search finds a phrase someone said. A podcast episode whose page links to its audio gets a transcript too.",
      },
      {
        question: "How do links between notes work?",
        answer:
          "Type `[[` in a note and choose a card to link it. Open that card to see every note that links to it.",
      },
      {
        question: "Can I take my research with me?",
        answer:
          "Yes. Export everything, with original files, as a ZIP at any time. You can also import your browser bookmarks or a Teak archive.",
      },
    ],
    guide: {
      href: "/docs/features#smart-search",
      label: "See what search reads",
    },
  },
  "save-without-filing": {
    slug: "save-without-filing",
    navLabel: "Save without filing",
    summary:
      "If filing things gets in the way, save in one step and let Teak tag it.",
    title: "Save without filing, for people with ADHD",
    description:
      "If filing things gets in the way, save in one step and let Teak tag, summarize and resurface your cards. No folder to pick, no sorting to do.",
    h1: "Save without filing",
    intro:
      "For people with ADHD, and anyone whose ideas arrive faster than they can put them away. Save in one step from wherever you are. Teak tags and summarizes every card, so there's no sorting to do.",
    featuresTitle: "Save now, find it later",
    features: [
      {
        icon: "zap",
        title: "Save in one step",
        description:
          "Open the browser extension and the page is saved. Share from your phone, forward an email, or use the Mac app or Raycast. No folder to pick first.",
      },
      {
        icon: "tags",
        title: "Tags and summaries, done for you",
        description:
          "Every card gets tags and a short summary in the background. You never have to name, sort or file anything.",
      },
      {
        icon: "search",
        title: "Search for what you remember",
        description:
          "Search finds cards by meaning, not exact words. Type `cozy reading nook` and it finds the armchair by the window. A typo still finds what you meant.",
      },
      {
        icon: "rotate-ccw",
        title: "Revisit, a few at a time",
        description:
          "Revisit shows 20 random cards, one at a time. Keep what still matters and archive the rest with a swipe or a key, with Undo if you change your mind.",
      },
      {
        icon: "eye-off",
        title: "Private when you want it",
        description:
          "Tag a card `secret` or `hidden` and it stays out of your library, search and Shuffle until you search for that tag.",
      },
      {
        icon: "maximize-2",
        title: "Write with nothing else on screen",
        description:
          "Focus mode shows only your note, in one quiet column. Press `⌘E` to open it, and an existing note saves on its own as you type.",
      },
    ],
    demoCardIds: [
      "flower",
      "kickoff-memo",
      "rams",
      "hangers",
      "onboarding-critique",
      "desk",
      "harbor",
      "nng",
      "jacket",
      "spacing",
      "camera",
      "vignelli",
      "terracotta",
      "inter",
      "building",
      "type-scale",
      "laptop-flatlay",
      "signal",
    ],
    faqs: [
      {
        question: "Do I have to organize anything?",
        answer:
          "No. Save things as they come. Teak adds tags and a summary to each card, and search finds cards by what they're about. Folders are there if you want them, but nothing needs one.",
      },
      {
        question: "Is Teak an ADHD app?",
        answer:
          "Teak is a place to keep ideas, not a medical or health app. We made this page for people with ADHD, and for anyone else who finds that filing things gets in the way of saving them.",
      },
      {
        question: "What if I save something and forget about it?",
        answer:
          "That's fine; Teak remembers it for you. Revisit brings back 20 random cards at a time so you can keep or archive each one, and Shuffle shows your library in a new order.",
      },
      {
        question: "Can I keep some cards private?",
        answer:
          "Yes. Tag a card `secret` or `hidden` and it leaves your library, search, folders and Shuffle on every app. Search `#secret` or `tag:hidden` to see those cards again.",
      },
      {
        question: "How much does it cost?",
        answer: `Teak is free for your first ${FREE_CARD_LIMIT} cards, with every feature. Pro removes the limit.`,
      },
    ],
    guide: {
      href: "/docs/features#sort-and-share-a-search",
      label: "See how Revisit works",
    },
  },
};

export const AUDIENCE_PAGE_LIST: AudiencePage[] = AUDIENCE_SLUGS.map(
  (slug) => AUDIENCE_PAGES[slug]
);

export interface TextSegment {
  code: boolean;
  text: string;
}

export function splitInlineCode(text: string): TextSegment[] {
  return text
    .split("`")
    .map((part, index) => ({ code: index % 2 === 1, text: part }))
    .filter((segment) => segment.text.length > 0);
}

export function toPlainText(text: string): string {
  return text.replaceAll("`", "");
}

export function audiencePageUrl(slug: AudienceSlug): string {
  return `${SITE_URL}/${slug}`;
}

export function buildAudiencePageSchemas(page: AudiencePage) {
  const url = audiencePageUrl(page.slug);

  return buildPageSchemas({
    title: page.title,
    description: toPlainText(page.description),
    url,
    breadcrumbs: [
      { name: "Home", url: SITE_URL },
      { name: page.navLabel, url },
    ],
    faqs: page.faqs.map((faq) => ({
      question: toPlainText(faq.question),
      answer: toPlainText(faq.answer),
    })),
  });
}
