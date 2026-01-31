Teak is a personal knowledge hub designed to help creative minds effortlessly collect, remember, and rediscover their most important ideas and inspirations.

## Quick Commands

```bash
# Install dependencies
bun install

# Dev (web + convex backend)
bun run dev

# All services (web, mobile, extension, docs, convex)
bun run dev:all

# Individual services
bun run dev:web        # Next.js web + Convex
bun run dev:convex     # Convex backend only
bun run dev:mobile     # Expo mobile + Convex
bun run dev:extension  # Browser extension + Convex
bun run dev:docs       # Documentation site

# Build/package browser extension
bun run build:extension
bun run package:extension

# Production build / start
bun run build
bun run start

# Lint & Typecheck
bun run lint
bun run typecheck

# Tests
bun run test

# Manage deps (in specific workspace)
bun add <package-name> --filter @teak/web
bun add --dev <package-name> --filter @teak/convex
```

## Architecture at a Glance

## Quality Bar

- When adding a feature, write or update tests and make sure `bun run test` passes.
- Add/extend tests for new features or bug fixes.
- Prefer Playwright for user-facing flows; add at least one happy-path and one edge case.
- Update or add fixtures/test data so tests are deterministic.
- If a feature changes UI or copy, update any assertions that check text/labels.
- Keep tests fast; avoid extra network calls unless the feature requires it.

- **Core stack**: Next.js (App Router, TS, Tailwind), Expo RN, Wxt + Chrome APIs, Fumadocs (Next.js + MDX), Convex backend, Better Auth, shadcn/ui (web) & Expo UI, Convex Storage, Polar billing.
- **Repo layout (Turborepo monorepo)**

```
teak/
├── apps/
│   ├── web/         # Next.js frontend (app router, shadcn/ui)
│   ├── mobile/      # Expo RN mobile app
│   ├── extension/   # Chrome extension (Wxt)
│   └── docs/        # Documentation site (Fumadocs)
├── packages/
│   └── convex/      # Convex backend (functions, workflows, schema, shared utils)
├── scripts/         # Build/setup scripts
├── tests/           # E2E tests (Playwright)
├── turbo.json       # Turborepo pipeline config
└── package.json     # Root package + workspaces
```

## Client-Server Patterns

- **Queries**: Real-time cached data via `convex-helpers/react/cache` `useQuery`, wrapped by `ConvexQueryCacheProvider`.
- **Mutations**: Server actions through `useMutation` / `useAction` from `@teak/convex`.
- **Auth context**: Better Auth sessions flow automatically to Convex with `@convex-dev/better-auth`.
- **App wrapping**: `ConvexClientProvider` + `ConvexQueryCacheProvider` wrap trees (web, mobile, extension) to share auth + cached queries; real-time updates propagate automatically.
- **Data flow**: 1) UI renders cards (web, mobile, extension, docs) → 2) providers wrap tree → 3) Convex functions handle server logic with `ctx.auth` → 4) live updates pushed to clients.
- **Imports**: `import { api } from "@teak/convex"`, `import { Doc } from "@teak/convex/_generated/dataModel"`, `import { CARD_TYPES } from "@teak/convex/shared/constants"`.
- **File uploads**: two-step (generate upload URL → upload file) — full flow in "File Upload Pattern."

## Product Domain — Cards

- **Types**: text, link, image, video, audio, document, palette, quote.
- **Schema highlights (packages/convex/schema.ts)**: user-scoped `userId`; soft delete via `isDeleted`/`deletedAt`; rich type metadata; file links via `fileId`/`thumbnailId`; tagging + favorites; link metadata with normalized category/provider/confidence; `processingStatus` stages (`classify`, `categorize`, `metadata`, `renderables`).
- **Operations**: soft delete (30-day cleanup), automatic storage cleanup, real-time search/filtering (type, favorites, tags), batch restore/perma-delete/toggle favorites.

## AI Processing Pipeline

- Orchestrated in `packages/convex/workflows/cardProcessing.ts` using `@convex-dev/workflow` with per-step retries.
- Sequence: classification (detect type + palette colors) → categorization (links; waits for metadata) → metadata (AI tags, summary, transcript) → renderables (media thumbnails; skips tiny originals; writes via internal mutations).
- Helpers: `packages/convex/workflows/functionRefs.ts` + `packages/convex/ai`.
- Logging: updates `processingStatus` and logs with `[workflow/*]` prefixes for admin dashboards.
- Link metadata: `packages/convex/workflows/linkMetadata.ts` via `startLinkMetadataWorkflow`;

## Authentication

- **Web**: Email/password routes at `/login`, `/register`, `/forgot-password`, `/reset-password`; `ConvexBetterAuthProvider` shares session to Convex via `@convex-dev/better-auth`; middleware/server actions rely on `ctx.auth`.
- **Mobile**: `better-auth/react` + `@better-auth/expo/client` with SecureStore; `ConvexBetterAuthProvider` wraps the app so Convex calls carry the auth token.
- **Extension**: Popup bootstraps Better Auth with `createAuthClient` + cross-domain plugin; `ConvexBetterAuthProvider` shares session for background/content interactions.

## App Surfaces

- Search & Filtering implemented in `useSearchFilters` hook: real-time search across content/metadata, tag keyword extraction, type filtering, favorites/trash state filters, typeahead suggestions.
- **Web (apps/web/)**: `src/app/(auth)/`, `src/app/(settings)/admin`, `src/globals.css`, `src/layout.tsx`, `src/page.tsx`; components include `ConvexClientProvider`, card previews, `DragOverlay`, `CardModal`, `AddCardForm`, `MasonryGrid`, `SearchBar`, patterns, shadcn/ui; hooks (`useCardActions`, `useCardModal`, `useGlobalDragDrop`); config (`next.config.ts`, `eslint.config.mjs`, `components.json`).
- **Mobile (apps/mobile/)**: `app/(auth)/`, `app/(tabs)/index.tsx|add.tsx|settings.tsx`, `_layout.tsx`; components (Expo UI, `CardItem`, `CardsGrid`); `lib/hooks`; `package.json`.
- **Extension (apps/extension/)**: `src/background.ts`, `content.tsx`, `popup.tsx`; hooks (`useAutoSaveLink`, `useContextMenuSave`, `useContextMenuState`); types `contextMenu.ts`; `style.css`; assets `icon.png`; `package.json`; `tsconfig.json`.
- **Backend (packages/convex/)**: directories `_generated/`, `workflows/`, `ai/`, `card/`, `billing.ts`, `admin.ts`, `schema.ts`, `cards.ts`, `auth.config.ts`, `crons.ts`, `convex.config.ts`, entrypoint `index.ts`; shared utils/constants/hooks under `shared/`.
- **Docs (apps/docs/)**: `app/(home)/`, `app/docs/[[...slug]]/` + `layout.tsx`, API routes under `app/api/`, root `layout.tsx`, `global.css`; components; `content/docs/`; `lib/`; `source.config.ts`; `package.json`.
- **Shared code (packages/convex/shared/)**: `constants.ts`, `index.ts`, `linkCategories.ts`, hooks (`useCardActions.ts`, `useFileUpload.ts`), utils (`colorUtils.ts`).
- **Repo**: Turborepo monorepo with workspaces in `apps/*` and `packages/*`; TypeScript paths point to `@teak/convex` aliases; turbo runs tasks with `--filter` for individual apps.
- **Convex**: hot deployment on save; schema changes need migrations; define indexes in `schema.ts`; scheduled functions in `crons.ts`; config in `packages/convex/convex.config.ts`; workflows must keep `processingStatus` consistent; Polar integration depends on `components.polar` + env keys `POLAR_ACCESS_TOKEN`, `POLAR_SERVER`;
- **Component patterns**: compound components (CardModal, SearchBar), business-logic hooks (`useCardActions`, `useSearchFilters`, `useAutoSaveLink`), shadcn/ui on web, masonry grid for cards, card preview components per type (text/link/image/video/audio/document), root layout composes ThemeProvider + ConvexClientProvider (Better Auth + Convex) + ConvexQueryCacheProvider + Sonner toasts, Convex handles server state + real-time updates via `ConvexQueryCacheProvider` + `convex-helpers` hooks.
- Actions `api.billing.createCheckoutLink` / `createCustomerPortal` in `packages/convex/billing.ts` coordinate Polar SDK + Convex `components.polar`.
- `userHasPremium` query caches membership; pairs with `FREE_TIER_LIMIT` for caps; UI shows usage badge, feature list, and customer portal launcher—keep messaging aligned with `featureList`.

# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Format code**: `bun x ultracite fix`
- **Check for issues**: `bun x ultracite check`
- **Diagnose setup**: `bun x ultracite doctor`

Biome (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Use proper image components (e.g., Next.js `<Image>`) over `<img>` tags

### Framework-Specific Guidance

**Next.js:**
- Use Next.js `<Image>` component for images
- Use `next/head` or App Router metadata API for head elements
- Use Server Components for async data fetching instead of async Client Components

**React 19+:**
- Use ref as a prop instead of `React.forwardRef`

**Solid/Svelte/Vue/Qwik:**
- Use `class` and `for` attributes (not `className` or `htmlFor`)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Biome Can't Help

Biome's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Biome can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Biome. Run `bun x ultracite fix` before committing to ensure compliance.

# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Format code**: `bun x ultracite fix`
- **Check for issues**: `bun x ultracite check`
- **Diagnose setup**: `bun x ultracite doctor`

Biome (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Use proper image components (e.g., Next.js `<Image>`) over `<img>` tags

### Framework-Specific Guidance

**Next.js:**
- Use Next.js `<Image>` component for images
- Use `next/head` or App Router metadata API for head elements
- Use Server Components for async data fetching instead of async Client Components

**React 19+:**
- Use ref as a prop instead of `React.forwardRef`

**Solid/Svelte/Vue/Qwik:**
- Use `class` and `for` attributes (not `className` or `htmlFor`)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Biome Can't Help

Biome's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Biome can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Biome. Run `bun x ultracite fix` before committing to ensure compliance.
