import {
  defineCollections,
  defineConfig,
  defineDocs,
  frontmatterSchema,
  metaSchema,
} from 'fumadocs-mdx/config';
import { z } from 'zod';

// You can customise Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.vercel.app/docs/mdx/collections#define-docs
export const docs = defineDocs({
  docs: {
    schema: frontmatterSchema,
  },
  meta: {
    schema: metaSchema,
  },
});

// Changelog collection for AI-generated batch summaries (40 commits per batch)
export const changelog = defineCollections({
  type: 'doc',
  dir: './content/changelog',
  schema: z.object({
    title: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    commitCount: z.number(),
    batchNumber: z.number(),
  }),
});

export default defineConfig({
  mdxOptions: {
    // MDX options
  },
});
