import localFont from "next/font/local";

// Allo by Josh Puckett (SIL OFL 1.1, ./fonts/Allo-OFL.txt). The root layout
// and global-error both render <html>, so both import these.
export const allo = localFont({
  src: "./fonts/AlloVariableFriendly.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-allo",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "font-family", value: "Allo" }],
});

// Allo has no variable oblique, so italics use its drawn obliques at the
// weights the app sets.
export const alloOblique = localFont({
  src: [
    { path: "./fonts/Allo-Oblique.woff2", weight: "400", style: "italic" },
    {
      path: "./fonts/Allo-MediumOblique.woff2",
      weight: "500",
      style: "italic",
    },
    {
      path: "./fonts/Allo-SemiBoldOblique.woff2",
      weight: "600",
      style: "italic",
    },
    { path: "./fonts/Allo-BoldOblique.woff2", weight: "700", style: "italic" },
  ],
  variable: "--font-allo-oblique",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "font-family", value: "Allo" }],
  preload: false,
});

export const fontClassName = `${allo.variable} ${alloOblique.variable}`;
