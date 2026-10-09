// Sample library for the interactive web app preview on the homepage.
// Each card mirrors a real Teak card type and renders with the same markup
// as the web app grid (packages/ui/src/components/cards/Card.tsx).

export type DemoCardType =
  | "text"
  | "link"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "palette"
  | "quote";

export interface DemoImage {
  /** Larger file for the card detail view, like the app's full image. */
  full?: string;
  height: number;
  src: string;
  width: number;
}

export interface DemoCard {
  aiTags?: string[];
  colors?: string[];
  content?: string;
  favorite?: boolean;
  id: string;
  image?: DemoImage;
  summary?: string;
  tags?: string[];
  title?: string;
  type: DemoCardType;
  url?: string;
}

/** Labels and Lucide icon names, matching CARD_TYPE_LABELS in the app. */
export const DEMO_CARD_TYPES: Record<
  DemoCardType,
  { icon: string; label: string }
> = {
  text: { icon: "file-text", label: "Text" },
  link: { icon: "link", label: "Link" },
  image: { icon: "image", label: "Image" },
  video: { icon: "video", label: "Video" },
  audio: { icon: "volume-2", label: "Audio" },
  document: { icon: "file", label: "Document" },
  palette: { icon: "palette", label: "Palette" },
  quote: { icon: "quote", label: "Quote" },
};

const img = (name: string, width: number, height: number): DemoImage => ({
  src: `/home-demo/${name}.webp`,
  width,
  height,
});

/** Photos ship a grid thumbnail plus a larger file for the detail view. */
const photo = (name: string, width: number, height: number): DemoImage => ({
  ...img(name, width, height),
  full: `/home-demo/${name}-full.webp`,
});

/**
 * Cards grouped by the five desktop columns. Narrow layouts flow the same
 * order through fewer columns.
 */
export const DEMO_COLUMNS: DemoCard[][] = [
  [
    {
      id: "onboarding-critique",
      type: "text",
      content:
        "Onboarding critique: lead with the person's goal, not a feature tour. Cut step three, it repeats the welcome screen.",
      tags: ["critique"],
      summary:
        "Feedback on an onboarding flow: open with the user's goal and remove a duplicate step.",
      aiTags: ["onboarding", "ux", "feedback"],
    },
    {
      id: "inter",
      type: "link",
      title: "Inter font family",
      url: "https://rsms.me/inter/",
      image: img("link-inter", 251, 128),
      colors: ["#00CF43", "#FBFCFC", "#313B33"],
      tags: ["fonts"],
      summary:
        "Inter is a variable sans-serif typeface designed for computer screens, with tabular numbers and many OpenType features.",
      aiTags: ["typography", "typeface", "sans-serif", "variable font"],
    },
    {
      id: "vignelli",
      type: "quote",
      content:
        "Styles come and go. Good design is a language, not a style. — Massimo Vignelli",
      summary: "Massimo Vignelli on design as a lasting language.",
      aiTags: ["design", "quote", "vignelli"],
    },
    {
      id: "shadcn",
      type: "link",
      title: "shadcn/ui - The Foundation for your Design System",
      url: "https://ui.shadcn.com",
      image: img("link-shadcn", 251, 128),
      colors: ["#000000", "#4B4B4B", "#FFFFFF"],
      tags: ["components"],
      summary:
        "Accessible, customizable components you copy into your project to start your own component library.",
      aiTags: ["design system", "components", "react", "ui kit"],
    },
  ],
  [
    {
      id: "hangers",
      type: "video",
      title: "hanger-color-sort.mp4",
      image: photo("hangers", 480, 607),
      colors: ["#232A29", "#69715C", "#D6C8B1", "#9EB2AA"],
      tags: ["motion"],
      summary:
        "A slow pan along a clothing rail with wooden hangers, sorted by color under a calendar wall.",
      aiTags: ["retail", "color", "fashion", "editorial"],
    },
    {
      id: "harbor",
      type: "palette",
      content: "Harbor palette",
      colors: ["#1D3557", "#457B9D", "#A8DADC", "#F1FAEE", "#E63946"],
      tags: ["palettes"],
      summary: "A cool navy and seafoam palette with one warm red accent.",
      aiTags: ["navy", "coastal", "contrast"],
    },
    {
      id: "refactoring-ui",
      type: "link",
      title: "Refactoring UI",
      url: "https://www.refactoringui.com",
      image: img("link-refactoring", 251, 122),
      colors: ["#111829", "#343F4D", "#E8E8E8"],
      favorite: true,
      tags: ["books"],
      summary:
        "A book of practical design tactics for developers who want their interfaces to look better without a designer.",
      aiTags: ["ui design", "book", "tactics", "tailwind"],
    },
    {
      id: "type-scale",
      type: "text",
      content:
        "Type scale 12 · 14 · 16 · 20 · 24 · 32 · 48. Body line height 1.5, headings 1.1.",
      tags: ["tokens"],
      summary: "Type scale and line heights for the design system.",
      aiTags: ["typography", "scale", "tokens"],
    },
    {
      id: "signal",
      type: "palette",
      content: "Signal palette",
      colors: ["#2B2D42", "#8D99AE", "#EDF2F4", "#EF233C", "#D90429"],
      tags: ["palettes"],
      summary: "Slate neutrals with two saturated reds for alerts and CTAs.",
      aiTags: ["slate", "red", "ui"],
    },
  ],
  [
    {
      id: "desk",
      type: "image",
      content: "Brand identity flat lay on a desk",
      image: photo("desk", 480, 357),
      colors: ["#C99A78", "#8A5A4F", "#D3C1A5", "#F9F4E7"],
      tags: ["branding"],
      summary:
        "A desk flat lay with a brand book, logo sketches, stationery, and color pencils in warm light.",
      aiTags: ["branding", "flat lay", "stationery", "workspace"],
    },
    {
      id: "building",
      type: "image",
      content: "Brutalist concrete tower",
      image: photo("building", 480, 594),
      colors: ["#AFCFC2", "#5B5645", "#D9E4D5", "#A3A288"],
      tags: ["architecture"],
      summary:
        "A weathered concrete tower with stacked balconies against a pale teal sky.",
      aiTags: ["brutalism", "architecture", "concrete", "texture"],
    },
    {
      id: "kickoff-memo",
      type: "audio",
      title: "Kickoff voice memo",
      tags: ["client"],
      summary:
        "Notes from the client kickoff: warmer colors, a bolder wordmark, and a launch in early spring.",
      aiTags: ["meeting", "branding", "voice memo"],
    },
    {
      id: "flower",
      type: "image",
      content: "Coral flowers close-up",
      image: img("flower", 640, 640),
      colors: ["#F58D6C", "#C26756", "#AB3847", "#F8A47C", "#F5B98A"],
      favorite: true,
      summary:
        "A close-up of coral flowers blooming with delicate petals and bright yellow centers.",
      aiTags: ["flower", "bloom", "floral", "nature", "petal"],
    },
  ],
  [
    {
      id: "terracotta",
      type: "palette",
      content: "Terracotta palette",
      colors: ["#E0472F", "#F5EFE6", "#1C1B1A", "#7FA58F", "#E9B04B"],
      tags: ["palettes"],
      summary: "Warm terracotta and mustard balanced by sage and ink.",
      aiTags: ["warm", "earthy", "retro"],
    },
    {
      id: "jacket",
      type: "image",
      content: "Menswear shop interior",
      image: photo("jacket", 480, 597),
      colors: ["#231F1C", "#C9B6A1", "#7E6C60", "#DBD9D5"],
      tags: ["interiors"],
      summary:
        "A shop wall with a navy blazer on a hook, framed prints, and a painted oar on wooden panels.",
      aiTags: ["interior", "retail", "menswear", "wood"],
    },
    {
      id: "nng",
      type: "link",
      title: "10 Usability Heuristics for User Interface Design",
      url: "https://www.nngroup.com/articles/ten-usability-heuristics/",
      image: img("link-nng", 252, 128),
      colors: ["#27225C", "#545179", "#F5C518"],
      tags: ["ux"],
      summary:
        "Jakob Nielsen's ten general principles for interaction design, from visibility of system status to error prevention.",
      aiTags: ["usability", "heuristics", "ux research"],
    },
    {
      id: "camera",
      type: "image",
      content: "Vintage rangefinder camera",
      image: photo("camera", 480, 318),
      colors: ["#191E1C", "#433D2E", "#EDE7D5", "#A6916F"],
      summary:
        "A vintage rangefinder camera resting on piano keys in warm, low light.",
      aiTags: ["camera", "vintage", "product", "moody"],
    },
  ],
  [
    {
      id: "rams",
      type: "quote",
      content: "Good design is as little design as possible. — Dieter Rams",
      favorite: true,
      summary: "Dieter Rams' tenth principle of good design.",
      aiTags: ["design", "minimalism", "rams"],
    },
    {
      id: "northwind",
      type: "document",
      title: "Northwind brand guidelines.pdf",
      image: img("doc-northwind", 251, 157),
      colors: ["#F3F0E6", "#1C1B1A", "#D9442B"],
      tags: ["branding", "client"],
      summary:
        "Brand guidelines for Northwind Studio covering logo use, color, typography, and voice.",
      aiTags: ["brand guidelines", "identity", "pdf"],
    },
    {
      id: "laptop-flatlay",
      type: "image",
      content: "Monochrome desk flat lay",
      image: photo("laptop-flatlay", 480, 319),
      colors: ["#4E4E4E", "#969696", "#CDCDCD"],
      summary:
        "A monochrome flat lay of a laptop, a business book, headphones, sunglasses, pens, and keys.",
      aiTags: ["flat lay", "workspace", "monochrome", "minimal"],
    },
    {
      id: "spacing",
      type: "text",
      content: "Spacing tokens 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64",
      tags: ["tokens"],
      summary: "Spacing scale for layout and components.",
      aiTags: ["spacing", "tokens", "layout"],
    },
    {
      id: "laws-of-ux",
      type: "link",
      title: "Laws of UX",
      url: "https://lawsofux.com",
      tags: ["ux"],
      summary:
        "A collection of psychology principles designers can use when building interfaces.",
      aiTags: ["psychology", "ux", "principles"],
    },
  ],
];
