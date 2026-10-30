/** Cards as the public API serializes them (trimmed to what the view reads). */
export const linkCard = {
  aiSummary: "A field guide to variable fonts on the web.",
  aiTags: ["typography"],
  appUrl: "https://app.teakvault.com/?card=k1",
  colors: [],
  content: "https://example.com/fonts",
  id: "k1",
  isFavorited: true,
  linkPreviewImageUrl: "https://files.teakvault.com/r2/k1.webp?exp=1&sig=a",
  linkPreviewTitle: "Variable fonts, explained",
  linkSiteName: "Example",
  notes: "Read before the redesign",
  tags: ["fonts"],
  thumbnailUrl: null,
  type: "link",
  url: "https://example.com/fonts",
};

export const noteCard = {
  appUrl: "https://app.teakvault.com/?card=n1",
  colors: [],
  content: "# Launch checklist\nShip the connector, then the plugin.",
  id: "n1",
  isFavorited: false,
  tags: [],
  type: "text",
  url: null,
};

export const paletteCard = {
  appUrl: "https://app.teakvault.com/?card=p1",
  colors: [
    { hex: "#1F2937", name: "Ink" },
    { hex: "#F97316" },
    { hex: "not-a-color" },
  ],
  content: "#1F2937 #F97316",
  id: "p1",
  isFavorited: false,
  metadataTitle: "Sunset",
  tags: [],
  type: "palette",
};
