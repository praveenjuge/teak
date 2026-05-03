import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const docs = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/docs" }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    icon: z.string().optional(),
  }),
});

const changelog = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/changelog" }),
  schema: z.object({
    title: z.string(),
    date: z.string(),
  }),
});

export const collections = { docs, changelog };
