# teak-sdk

The public TypeScript client for the Teak API, published to npm as `teak-sdk`.

- `src/index.ts` is the client and the package's only entry. `authDiscovery.ts`, `workosConnect.ts` and `oauthCredentials.ts` hold the OAuth pieces it re-exports.
- Tests sit next to the code (`src/*.test.ts`). Run them with `bun run --cwd packages/sdk test`.
- Import shared values from `@teak/convex/shared/*`, never from Convex functions. `bun run build` inlines them into the bundle and ships their declarations under `dist/types/convex`.
- Two manifests:
  - `package.json` points `exports` at `src/` so the CLI, extension, docs and e2e tests use the source with no build step.
  - `build.ts` writes the published manifest into `dist/`, which `SDK Release` packs (`.agents/releases.md`).
- `scripts/sdk-package.test.ts` packs `dist/`, installs it outside the monorepo and type-checks it. Run it after changing `build.ts` or the public types.
- A new public API operation adds its method here. Follow `apps/docs/content/docs/(open-source)/adding-a-feature.mdx`, which keeps the API, MCP, SDK and CLI in step.
