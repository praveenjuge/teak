import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const docs = defineCollection({ loader: docsLoader(), schema: docsSchema() });

const changelog = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/changelog" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
  }),
});

export const collections = { docs, changelog };
