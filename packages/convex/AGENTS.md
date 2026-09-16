<!-- convex-ai-start -->
Before editing this workspace, read `_generated/ai/guidelines.md` completely. Its generated Convex API and architecture rules override general guidance.
<!-- convex-ai-end -->

Schema changes require explicit approval for any migration or backfill. Define indexes in `packages/convex/schema.ts` and scheduled jobs in `packages/convex/crons.ts`.
