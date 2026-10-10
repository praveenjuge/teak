/**
 * The designer library the store screenshots show. `seed.ts` adds these cards
 * to the signed-in Teak account in reverse order, so the first entry ends up
 * newest and leads every library view. Files live in `seed/`; each one lists
 * where it came from and its license.
 */

export type ShowcaseCard =
  | {
      kind: "file";
      file: string;
      source: string;
      license: string;
      notes?: string;
      tags?: string[];
      favorite?: boolean;
    }
  | {
      kind: "link";
      url: string;
      notes?: string;
      tags?: string[];
      favorite?: boolean;
    }
  | {
      kind: "text" | "quote" | "palette";
      content: string;
      /** Shown instead of the content, e.g. a palette's name. */
      title?: string;
      notes?: string;
      tags?: string[];
      favorite?: boolean;
    };

const UNSPLASH = "Unsplash License";
const AIC = "CC0, Art Institute of Chicago";

export const SHOWCASE: ShowcaseCard[] = [
  {
    kind: "file",
    file: "Axel Towers, Copenhagen.jpg",
    source: "https://unsplash.com/photos/K67sBVqLLuw",
    license: UNSPLASH,
    notes: "Curves that catch the light. Reference for the Halden lobby.",
    tags: ["architecture", "halden"],
    favorite: true,
  },
  {
    kind: "palette",
    content: "Kyoto moss #2F3A2F #5B6B4E #A3A380 #D6CFB4 #8C5E3C",
    title: "Kyoto moss",
    tags: ["color"],
  },
  {
    kind: "quote",
    content: "Styles come and go. Good design is a language, not a style.",
    notes: "— Massimo Vignelli",
    tags: ["quotes"],
  },
  {
    kind: "file",
    file: "Fallingwater.jpg",
    source: "https://unsplash.com/photos/5JMP-SCGc7I",
    license: UNSPLASH,
    notes: "Wright. The house and the stream as one composition.",
    tags: ["architecture"],
  },
  {
    kind: "text",
    content:
      "Type pairing for the Halden rebrand: a sharp serif for headlines, a quiet grotesk for body. Try 64/72 on the hero and loosen the tracking a touch.",
    tags: ["typography", "halden"],
  },
  {
    kind: "file",
    file: "Pantone swatch book.jpg",
    source: "https://unsplash.com/photos/LPWl2pEVGKc",
    license: UNSPLASH,
    tags: ["color"],
  },
  {
    kind: "link",
    url: "https://fontsinuse.com/",
    tags: ["typography"],
  },
  {
    kind: "file",
    file: "Stoneware vases.jpg",
    source: "https://unsplash.com/photos/R0qthXq3jec",
    license: UNSPLASH,
    tags: ["objects", "texture"],
  },
  {
    kind: "palette",
    content: "Bauhaus primaries #E63946 #F4C430 #1D3557 #F1FAEE #111111",
    title: "Bauhaus primaries",
    tags: ["color"],
    favorite: true,
  },
  {
    kind: "file",
    file: "Under the Wave off Kanagawa.jpg",
    source: "https://www.artic.edu/artworks/24645",
    license: AIC,
    notes: "Hokusai, 1830–33. That blue.",
    tags: ["print", "japan"],
  },
  {
    kind: "quote",
    content: "Design is thinking made visual.",
    notes: "— Saul Bass",
    tags: ["quotes"],
  },
  {
    kind: "file",
    file: "Concrete skylights.jpg",
    source: "https://unsplash.com/photos/Z6NZgwnhEG8",
    license: UNSPLASH,
    tags: ["architecture", "light"],
  },
  {
    kind: "link",
    url: "https://developer.apple.com/design/human-interface-guidelines",
    tags: ["ui", "guidelines"],
  },
  {
    kind: "file",
    file: "Eames lounge by the fire.jpg",
    source: "https://unsplash.com/photos/6uYe3CbKb8A",
    license: UNSPLASH,
    tags: ["furniture", "interiors"],
  },
  {
    kind: "file",
    file: "Halden client call.m4a",
    source: "Recorded for this showcase with macOS text to speech",
    license: "Original",
    tags: ["halden", "calls"],
  },
  {
    kind: "file",
    file: "Moulin Rouge, La Goulue.jpg",
    source: "https://www.artic.edu/artworks/82287",
    license: AIC,
    notes: "Toulouse-Lautrec, 1891. Flat color, huge type.",
    tags: ["poster"],
  },
  {
    kind: "link",
    url: "https://lawsofux.com/",
    tags: ["ux"],
  },
  {
    kind: "palette",
    content: "Riso pink and teal #FF48B0 #00838A #FFE800 #F7F3EA #1A1A1A",
    title: "Riso pink and teal",
    tags: ["color", "print"],
  },
  {
    kind: "file",
    file: "Spiral staircase.jpg",
    source: "https://unsplash.com/photos/5l6PTBM2smI",
    license: UNSPLASH,
    tags: ["architecture"],
  },
  {
    kind: "text",
    content:
      "Moodboard brief: warm minimal. Oak, travertine, linen, grainy film photos, lots of air. No stock smiles.",
    tags: ["halden", "moodboard"],
  },
  {
    kind: "file",
    file: "Calligraphy poster.jpg",
    source: "https://unsplash.com/photos/QCVPnnPVTjc",
    license: UNSPLASH,
    tags: ["typography", "poster"],
  },
  {
    kind: "link",
    url: "https://www.itsnicethat.com/",
    tags: ["inspiration"],
  },
  {
    kind: "file",
    file: "Diamond pattern facade.jpg",
    source: "https://unsplash.com/photos/iaquA2snPbk",
    license: UNSPLASH,
    tags: ["architecture", "pattern"],
  },
  {
    kind: "quote",
    content: "Less, but better.",
    notes: "— Dieter Rams",
    tags: ["quotes"],
    favorite: true,
  },
  {
    kind: "file",
    file: "Mishima, Morning Mist.jpg",
    source: "https://www.artic.edu/artworks/10926",
    license: AIC,
    notes: "Hiroshige. Layers of fog as layers of value.",
    tags: ["print", "japan"],
  },
  {
    kind: "link",
    url: "https://m3.material.io/",
    tags: ["ui", "guidelines"],
  },
  {
    kind: "file",
    file: "Leather tub chair.jpg",
    source: "https://unsplash.com/photos/Uxqlfigh6oE",
    license: UNSPLASH,
    tags: ["furniture"],
  },
  {
    kind: "palette",
    content: "Desert modernism #C96F4A #E9C9A0 #7A8B6F #F4EDE2 #3B2F2A",
    title: "Desert modernism",
    tags: ["color"],
  },
  {
    kind: "file",
    file: "Design system on screen.jpg",
    source: "https://unsplash.com/photos/_x335IZXxfc",
    license: UNSPLASH,
    tags: ["ui", "design-systems"],
  },
  {
    kind: "link",
    url: "https://linear.app/now/how-we-redesigned-the-linear-ui",
    tags: ["ui", "process"],
  },
  {
    kind: "file",
    file: "NASA Graphics Standards Manual 1976.pdf",
    source:
      "https://www.nasa.gov/wp-content/uploads/2015/01/nasa_graphics_manual_nhb_1430-2_jan_1976.pdf",
    license: "Public domain, NASA",
    notes: "The worm. Danne & Blackburn's grid is still the best.",
    tags: ["branding", "systems"],
    favorite: true,
  },
  {
    kind: "file",
    file: "Zodiaque, La Plume.jpg",
    source: "https://www.artic.edu/artworks/111986",
    license: AIC,
    tags: ["poster", "art-nouveau"],
  },
  {
    kind: "file",
    file: "White concrete curves.jpg",
    source: "https://unsplash.com/photos/ACt8ycSzpdE",
    license: UNSPLASH,
    tags: ["architecture"],
  },
  {
    kind: "link",
    url: "https://vercel.com/geist/introduction",
    tags: ["ui", "design-systems"],
  },
  {
    kind: "file",
    file: "Peacock and Dragon.jpg",
    source: "https://www.artic.edu/artworks/103918",
    license: AIC,
    notes: "William Morris, 1878. Pattern repeat study.",
    tags: ["pattern", "textile"],
  },
  {
    kind: "link",
    url: "https://www.noguchi.org/",
    tags: ["sculpture", "museum"],
  },
  {
    kind: "file",
    file: "Clay vases.jpg",
    source: "https://unsplash.com/photos/zeGT9j4ltRA",
    license: UNSPLASH,
    tags: ["objects"],
  },
  {
    kind: "quote",
    content: "The details are not the details. They make the design.",
    notes: "— Charles Eames",
    tags: ["quotes"],
  },
  {
    kind: "file",
    file: "Looking up, concrete.jpg",
    source: "https://unsplash.com/photos/mQiZnKwGXW0",
    license: UNSPLASH,
    tags: ["architecture"],
  },
  {
    kind: "link",
    url: "https://rauno.me/craft/interaction-design",
    tags: ["interaction"],
  },
  {
    kind: "link",
    url: "https://www.typewolf.com/",
    tags: ["typography"],
  },
  {
    kind: "file",
    file: "Curved oak ceiling.jpg",
    source: "https://unsplash.com/photos/JS3BH31COQg",
    license: UNSPLASH,
    tags: ["interiors", "wood"],
  },
  {
    kind: "link",
    url: "https://www.are.na/",
    tags: ["inspiration"],
  },
];
