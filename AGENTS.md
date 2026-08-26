Teak is a personal knowledge hub designed to help creative minds effortlessly collect, remember, and rediscover their most important ideas and inspirations.

## Quick Commands

```bash
# Install dependencies
bun install

# Dev (web + convex backend)
bun run dev

# Dev (all services)
bun run dev:all

# Individual services
bun run dev:web        # Next.js web + Convex
bun run dev:convex     # Convex backend only
bun run dev:mobile     # Expo mobile app
bun run dev:desktop    # Electron desktop app
bun run dev:extension  # Browser extension + Convex
bun run dev:raycast    # Raycast extension
bun run dev:docs       # Documentation site

# Build/package extensions
bun run build:extension
bun run build:raycast
bun run publish:raycast

# Production build / start
bun run build
bun run start

# Lint & Typecheck
bun run lint
bun run typecheck

# Tests
bun run test

# Quality checks (Ultracite)
bun run check
bun run fix

# Pre-commit (same as git hook)
bun run pre-commit

# Clear caches
bun run clean

# Manage deps (in specific workspace)
bun add <package-name> --filter @teak/web
bun add --dev <package-name> --filter @teak/convex
```

```
teak/
├── apps/
│   ├── web/         # Next.js frontend (app router, shadcn/ui)
│   ├── mobile/      # Expo RN mobile app
│   ├── desktop/     # Electron desktop app (React)
│   ├── extension/   # Chrome extension (Wxt)
│   ├── safari-extension/ # Native macOS Safari extension app
│   ├── raycast/     # Raycast extension
│   ├── cli/         # npm command line client
│   └── docs/        # Documentation site (Blume)
├── .agents/
│   └── skills/      # Agent Skills exposed through skills.sh-compatible repos
├── packages/
│   ├── convex/      # Convex backend, public API, MCP, SDK, functions, workflows, schema, shared utils
│   └── ui/          # Shared UI package (components, hooks, screens, feedback)
├── turbo.json       # Turborepo pipeline config
└── package.json     # Root package + workspaces
```

## Client-Server Patterns

- **Queries**: Real-time cached data via `convex-helpers/react/cache` `useQuery`, wrapped by `ConvexQueryCacheProvider`.
- **Mutations**: Server actions through `useMutation` / `useAction` from `@teak/convex`.
- **Auth context**: Better Auth sessions flow automatically to Convex with `@convex-dev/better-auth`.
- **App wrapping**: `ConvexClientProvider` + `ConvexQueryCacheProvider` wrap trees (web, mobile, extension) to share auth + cached queries; real-time updates propagate automatically.
- **Imports**: `import { api } from "@teak/convex"`, `import { Doc } from "@teak/convex/_generated/dataModel"`, `import { CARD_TYPES } from "@teak/convex/shared/constants"`.
- **Card Types**: text, link, image, video, audio, document, palette, quote.

## AI Processing Pipeline

- Orchestrated in `packages/convex/workflows/cardProcessing.ts` using `@convex-dev/workflow` with per-step retries.
- Sequence: classification (detect type + palette colors) → categorization (links; waits for metadata) → metadata (AI tags, summary, transcript) → renderables (media thumbnails; skips tiny originals; writes via internal mutations).
- Helpers: `packages/convex/workflows/functionRefs.ts` + `packages/convex/ai`.
- Link metadata: `packages/convex/workflows/linkMetadata.ts` via `startLinkMetadataWorkflow`;

## App Surfaces

- **Web (apps/web/)**: `src/app/(auth)/`, `src/app/(settings)/settings`, `src/globals.css`, `src/layout.tsx`, `src/page.tsx`; components include `ConvexClientProvider`, `SentryUserManager`, `JsonLd`, `GlobalFileDropProvider`; most UI components (card previews, grids, modals, forms, search, patterns) live in `@teak/ui`; Sentry error tracking via `instrumentation.ts`; config (`next.config.ts`, `eslint.config.mjs`, `components.json`).
- **Mobile (apps/mobile/)**: `app/(auth)/`, `app/(tabs)/(home)/|add/|settings/`, `_layout.tsx`; components (Expo UI, `CardItem`, `CardsGrid`, `CardPreviewSheet`, `ErrorBoundary`, `Logo`); `lib/hooks`, `lib/share`, `lib/auth-client.ts`, `lib/recording.ts`; `package.json`.
- **Desktop (apps/desktop/)**: Electron app with React frontend; `src/main/` for Electron main process; `src/preload/` for context bridge; `src/` for React renderer components; `src/pages/`, `src/hooks/`, `src/components/`, `src/lib/`; `forge.config.ts`, `vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.ts`, `electron-builder.config.ts`.
- **Extension (apps/extension/)**: Wxt-based Chrome extension; `entrypoints/background.ts`, `entrypoints/content.ts`, `entrypoints/content/`, `entrypoints/popup/`; hooks (`useAutoSaveUrl`, `useContextMenuSave`, `useWebAppSession`); types (`contextMenu.ts`, `messages.ts`, `social.ts`); `utils/`, `lib/`, `scripts/`; `style.css`; assets in `public/`; `wxt.config.ts`; `package.json`; `tsconfig.json`.
- **Safari Extension (apps/safari-extension/)**: Native macOS Safari Web Extension app for the Mac App Store. Keep Apple identifiers such as `com.praveenjuge.teak-safari`, the App Group, native messaging id, and keychain service stable unless intentionally creating a new App Store identity.
- **Raycast (apps/raycast/)**: Raycast extension with commands (`quick-save`, `save-clipboard-url`, `save-current-browser-tab`, `search-cards`, `favorites`), AI tools (`search-cards`, `get-card`, `save-card`), API client helpers, and extension metadata/changelog.
- **Backend/API/MCP/SDK (packages/convex/)**: directories `_generated/`, `workflows/`, `ai/`, `card/`, `client/`, `mcp/`, `linkMetadata/`, `migrations/`, `packages/`, `shared/`, `storage/`, `types/`; key files `billing.ts`, `admin.ts`, `schema.ts`, `cards.ts`, `auth.config.ts`, `auth.ts`, `authDesktop.ts`, `http.ts`, `apiKeys.ts`, `publicApi.ts`, `publicApiHttp.ts`, `publicApiMeta.ts`, `publicApiOpenApi.ts`, `raycast.ts`, `idempotency.ts`, `crons.ts`, `convex.config.ts`, `vercel.json`, entrypoint `index.ts`; shared utils/constants/hooks under `shared/`; SDK exports live at `@teak/convex/sdk`.
- **UI (packages/ui/)**: shared UI component library consumed by web, desktop, and extension; `src/components/` (cards, card-modal, card-previews, forms, grids, modals, patterns, search, selection, settings, ui); `src/feedback/` (skeletons, loading, error states, global file drop overlay, empty state); `src/screens/`, `src/hooks/`, `src/icons/`, `src/constants/`; `convexQueryCache.ts`, `convexQueryHooks.ts`, `logo.tsx`, `styles.css`.
- **Docs (apps/docs/)**: Blume static site; `content/docs/` for documentation MDX; `content/changelog/` for release notes; `pages/` for marketing routes; `components/`, `layouts/`, `lib/`, `styles/`; `blume.config.ts`; `theme.css`; `package.json`.
- **Repo**: Turborepo monorepo with workspaces in `apps/*` and `packages/*`; TypeScript paths point to `@teak/convex` aliases; turbo runs tasks with `--filter` for individual apps.
- **Convex**: hot deployment on save; schema changes need migrations; define indexes in `schema.ts`; scheduled functions in `crons.ts`; config in `packages/convex/convex.config.ts`; workflows must keep `processingStatus` consistent; Polar integration depends on `components.polar` + env keys `POLAR_ACCESS_TOKEN`, `POLAR_SERVER`;

## Docs Synchronization Rules

- Any API contract change in `packages/convex/http.ts`, `packages/convex/publicApiHttp.ts`, `packages/convex/publicApiMeta.ts`, or `packages/convex/publicApiOpenApi.ts` must update `apps/docs/content/docs/(developers)/api.mdx` in the same PR.
- Any MCP endpoint change in `packages/convex/mcp/` must update `apps/docs/content/docs/(developers)/mcp.mdx` in the same PR.
- Any Raycast command/auth change in `apps/raycast` must update `apps/docs/content/docs/(apps)/raycast.mdx` in the same PR.
- Any CLI command/auth/publish change in `apps/cli` or `packages/convex/client/sdk.ts` must update `apps/docs/content/docs/(apps)/cli.mdx` when user-facing behavior changes.
- Any public Agent Skill change in `.agents/skills` must update `apps/docs/content/docs/(developers)/skills.mdx` and `apps/docs/pages/apps.astro` when install or capability details change.

## Git Commit Rules

- Never use `--no-verify` when committing. Pre-commit hooks exist to catch lint and build errors before they land. If the hook fails, fix the underlying issue instead of bypassing it.

## Release Notes Hygiene

- Any user-visible feature change across web, mobile, desktop, extension, Raycast, API, or backend behavior must include a docs changelog update in `apps/docs/content/changelog/*.mdx`.
- When adding a feature, write or update tests and make sure `bun run test` passes.
- Add/extend tests for new features or bug fixes.
- Update or add fixtures/test data so tests are deterministic.
- Keep tests fast; avoid extra network calls unless the feature requires it.
- End-to-end tests live in `packages/tests` (Playwright, run against live production surfaces: web, REST API, CLI, MCP, docs, browser matrix, extension). Whenever a change affects an end-to-end, user-observable flow across those surfaces, add or extend an e2e test there in the same PR. Match the existing journey structure in `packages/tests/src/journey` and reuse the helpers in `packages/tests/src/helpers`. See `packages/tests/README.md` for how to run the suite.

## Changelog Editorial Rules

These rules govern everything that lands in `apps/docs/content/changelog/*.mdx`. The changelog is a public, user-facing product surface — not a release log for engineers.

- **Public entries describe user impact only.** If a user would not notice the change, do not publish it.
- **Do not mention** package names, frameworks, libraries, build tooling, bundlers, loaders, ESM/CJS, schemas, data migrations, internal endpoints, refactors, tests, CI, signing/notarization, dependency bumps, or any implementation mechanics. That includes (non-exhaustive): Electron, Vite, Webpack, Forge, Next.js, Astro, Starlight, Blume, Expo, Wxt, Hono, Convex (as backend), Better Auth, Polar, `electron-updater`, `electron-builder`, oEmbed, `package.json`, `tsconfig`.
- **Product-facing terms are fine** when users recognize them: desktop, mobile, web, browser extension, Raycast, API, MCP, sync, settings, import/export, updates, sign-in, macOS, Dock, notifications, keychain.
- **If the change is only internal** (tooling, dependency work, refactor, tests, CI, cleanup, silent maintenance), do not add a public changelog entry. Update the code and move on.
- **Format:** one frontmatter title plus 1–3 short bullets. No inline code (backticks), no fenced code blocks, no H2/H3 headers inside the entry.
- **Each bullet is one user-observable outcome.** Keep bullets ~1–2 sentences each; trim aggressively.
- **User action:** if the release requires the user to do something, state only the clear action they need to take, without the reason behind it.
- **One entry per date.** Rewriting a historical entry is preferred over merging or deleting.

## Mobile Release Process

When asked to release the mobile app (cut a new App Store version, publish to iOS, submit to TestFlight/App Store, or similar), follow `apps/mobile/release.md`. The canonical release trigger is one next-patch lockstep `package.json` bump merged to `main`. The Version Tag workflow creates the tag and dispatches the GitHub Actions macOS build, mandatory Sentry Size Analysis upload, asc upload/validation, and direct App Review submission. Do not use hosted EAS Build, EAS Submit, or manually edit Expo/App Store marketing versions.

Do not invent a release flow. Read `apps/mobile/release.md` and run the commands listed there in order.

## Desktop Release Process

The desktop app uses Electron with `electron-builder` and ships signed, notarized macOS builds via GitHub Releases.

Releases are always a patch version bump (e.g. 1.0.55 → 1.0.56). Do not ask for confirmation — just increment the patch, bump, commit, tag, and push.

To publish a new desktop release:

1. Bump the `version` field in **every** `package.json` across the monorepo (root + all workspaces under `apps/*` and `packages/*`).
2. Commit and push to `main`.
3. Create and push a version tag:
   ```bash
   git tag v<version>
   git push origin v<version>
   ```
4. The `Desktop Release` workflow (`.github/workflows/desktop-release.yml`) triggers on the `v*` tag and automatically:
   - Builds the renderer, main process, and preload via `vite build` (orchestrated by `bun run build`, driven by `@electron-forge/plugin-vite` configs) with production env vars.
   - Imports signing credentials (Developer ID certificate + App Store Connect API key) from GitHub Actions secrets.
   - Packages, code-signs, and notarizes the macOS ARM64 app via `electron-builder`.
   - Verifies codesign (`codesign --verify --deep --strict`), Gatekeeper assessment (`spctl --assess`), and stapled notarization ticket.
   - Publishes all artifacts (DMG, zip, blockmaps, `latest-mac.yml`) to a GitHub Release only after verification passes.
5. Existing installs pick up the update via `electron-updater` on next launch (with notifications and prompts).

## Extension Release Process

The browser extension ships automatically to the Chrome Web Store (plus GitHub Releases) through `.github/workflows/extension-release.yml`. It uses the same tag flow as the desktop app.

To publish a new extension release:

1. Bump the `version` field in **every** `package.json` across the monorepo (same step as the desktop release — one tag ships both).
2. Commit, push, and tag `v<version>`.
3. The `Extension Release` workflow triggers on the `v*` tag and automatically:
   - Verifies the tag version matches `apps/extension/package.json` (WXT reads the manifest version from there; `wxt.config.ts` intentionally does not hardcode it).
   - Runs `bun run zip` in `apps/extension` to build the production Chrome zip with the production env vars.
   - Uploads the zip to the Chrome Web Store and calls publish via the Chrome Web Store Publish API using `chrome-webstore-upload-cli`.
   - Uploads the same zip to the GitHub Release for the tag as `teak-extension-<version>-chrome.zip`.
4. Google queues the new version for review. Approved updates roll out to users automatically.

Required GitHub secrets: `CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`. See `apps/extension/release.md` for how to generate them.

Only the Chrome Web Store is automated today. There is no Firefox / Edge publishing step.

## CLI Release Process

The npm package is `teak-cli` and the installed binary is `teak`.

1. Bump the `version` field in every `package.json` across the monorepo.
2. Merge the version change to `main`.
3. The `Version Tag` workflow creates `v<version>` when all package versions match.
4. The `CLI Release` workflow publishes `apps/cli` to npm as `teak-cli` on the same tag.
5. The desktop, browser extension, iOS, and Safari release workflows also run from that tag.

## Safari Extension Release Process

Follow `apps/safari-extension/release.md`. Keep Apple-facing identifiers stable
unless intentionally creating a new App Store identity.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Cursor Cloud specific instructions

### Runtime

- Package manager: **Bun 1.3.5** (`packageManager` in root `package.json`). If `bun` is missing, install with `curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.5"` and ensure `~/.bun/bin` is on `PATH`.
- Dependency refresh on startup: `bun install --frozen-lockfile` from the repo root (see VM update script).

### Minimum dev stack (web + Convex)

`bun run dev:web` uses `turbo watch`, which requires an interactive TUI. In headless/tmux Cloud VMs, either set `TURBO_UI=tui` or start services separately (recommended):

1. **Convex** (tmux session `convex-dev`, cwd `packages/convex`):
   ```bash
   export CONVEX_AGENT_MODE=anonymous
   bun run dev
   ```
   On first run, set required Convex env vars on the anonymous deployment (dummy values are fine for local dev):
   ```bash
   bunx convex env set GOOGLE_CLIENT_ID test
   bunx convex env set GOOGLE_CLIENT_SECRET test
   bunx convex env set SITE_URL http://localhost:4330
   bunx convex env set JWKS '<JwksDoc JSON array — see @convex-dev/better-auth auth-config docs>'
   ```
   Generate `JWKS` with a short Bun script that exports an array of `{ id, publicKey, privateKey, createdAt, alg }` objects (RSA keys via `jose`).

2. **Web** (tmux session `web-dev`, cwd `apps/web`):
   ```bash
   bunx portless app.teak next dev
   ```
   Portless prints the bound port (often `4330`). Create `apps/web/.env.local` from `packages/convex/.env.local`:
   ```
   NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210
   NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211
   ```

3. Open **`http://localhost:<port>/login`** (direct localhost, not `app.teak.localhost`, unless portless HTTPS is configured).

### Auth gotcha (Cloud VMs)

Better Auth validates the browser `Origin` against `SITE_URL` / trusted origins. If sign-up/login returns **Invalid origin**, set Convex `SITE_URL` to the exact origin you use in the browser (e.g. `http://localhost:4330`), then retry after Convex redeploys.

Mark test users verified without email: `POST http://127.0.0.1:3210/api/internal/testSetup:markUserVerified` with `{"email":"..."}`.

### Lint, typecheck, tests

Standard commands from the repo root: `bun run lint`, `bun run typecheck`, `bun run test`. See **Quick Commands** above.

### Optional services

- Docs: `bun run dev:docs` (also needs portless/turbo TUI considerations).
- Mobile/desktop/extension: see **Quick Commands**; they need Convex URLs in their own `.env.local` files and are not required for web-only work.
