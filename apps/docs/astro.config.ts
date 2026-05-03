import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://teakvault.com",
  output: "static",
  integrations: [
    mdx(),
    react(),
    sitemap({
      filter: (page) => !page.includes("/404"),
    }),
  ],
  vite: {
    plugins: [tailwindcss() as any],
  },
  redirects: {
    "/docs/environment-settings": "/docs/self-hosting#environment-settings",
  },
});
