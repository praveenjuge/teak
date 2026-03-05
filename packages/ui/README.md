# @teak/ui

Shared UI package for Teak applications — consolidates components, hooks, screens, icons, and utilities used across `apps/web`, `apps/desktop`, `apps/mobile`, and `apps/extension`.

## Installation

This is a private workspace package. Add it as a peer dependency in any Teak app:

```bash
bun add @teak/ui --filter @teak/your-app
```

Import from any named export path listed below.

---

## Exports Reference

### Logo

```tsx
import Logo from "@teak/ui/logo";

export function Header() {
  return <Logo variant="primary" />;
}
```

**Props:** `variant?: "default" | "primary" | "current"`

---

### Styles

Global CSS (TailwindCSS base + custom design tokens). Import once at the app root.

```tsx
import "@teak/ui/styles.css";
```

---

### Shared UI Primitives — `@teak/ui/components/ui/*`

Re-exported shadcn/ui + Radix primitives. Available components:

`alert` · `avatar` · `badge` · `button` · `card` · `checkbox` · `context-menu` · `dialog` · `dropdown-menu` · `input` · `label` · `progress` · `select` · `separator` · `skeleton` · `sonner` · `spinner` · `table` · `textarea`

```tsx
import { Button } from "@teak/ui/components/ui/button";
import { Badge } from "@teak/ui/components/ui/badge";
```

---

### Cards

```tsx
import { Card, isOptimisticCard } from "@teak/ui/cards";
import type { CardProps, CardWithUrls, LinkPreviewMetadata } from "@teak/ui/cards";

// Card preview sub-components
import {
  AudioWavePreview,
  GridDocumentPreview,
  GridImagePreview,
  GridVideoPreview,
  LinkCardWithImage,
  LinkImageDisplay,
} from "@teak/ui/cards/previews";
```

**Card modal** (detail view with actions):

```tsx
import { CardModal } from "@teak/ui/card-modal";
```

---

### Grids

```tsx
import { MasonryGrid } from "@teak/ui/grids";
```

Responsive masonry layout for card collections.

---

### Forms

```tsx
import {
  AddCardForm,
  AddCardEmptyState,
  FullScreenAddCardDialog,
} from "@teak/ui/forms";
```

---

### Search

```tsx
import { SearchBar, CardsSearchHeader } from "@teak/ui/search";
```

---

### Modals

```tsx
import {
  MoreInformationModal,
  NotesEditModal,
  TagManagementModal,
} from "@teak/ui/modals";
```

---

### Selection

```tsx
import { BulkActionBar } from "@teak/ui/selection";
```

Bulk-action toolbar shown when multiple cards are selected.

---

### Settings Components

```tsx
import {
  ApiKeysSection,
  CustomerPortalButton,
  DeleteAccountDialog,
  ErrorAlert,
  PlanOption,
  SettingRow,
  SettingsContent,
  SettingsFooter,
  SubscriptionSection,
  ThemeToggle,
} from "@teak/ui/settings";
```

---

### Screens

Full-page screen shells consumed by individual apps:

```tsx
import { AuthScreenShell } from "@teak/ui/screens";
import { CardsScreen } from "@teak/ui/screens";
import { SettingsShell } from "@teak/ui/screens";
```

---

### Patterns (Decorative)

```tsx
import { TopPattern, BottomPattern } from "@teak/ui/patterns";
```

---

### Feedback / Loading States

```tsx
import {
  CardSkeleton,
  CardsGridSkeleton,
  DragOverlay,
  EmptyState,
  ErrorBoundary,
  Loading,
  PageErrorState,
  PageLoadingState,
} from "@teak/ui/feedback";

// Or per-component paths:
import { DragOverlay } from "@teak/ui/feedback/DragOverlay";
import { PageLoadingState } from "@teak/ui/feedback/PageLoadingState";
```

---

### Icons

```tsx
import { AppleIcon, GoogleIcon } from "@teak/ui/icons";
```

---

### Hooks

```tsx
import {
  useCardActions,
  useCardClipboard,
  copyCardContentToClipboard,
  useCardModal,
  createCardModalFilterActions,
  useCardModalFilterActions,
  useCardQueryParamState,
  normalizeCardQueryId,
  useCardsSearchController,
  applyBackspaceToCardsSearchState,
  applyEnterToCardsSearchState,
  buildCardsSearchQueryArgs,
  buildCardsSearchResetKey,
  buildCardsSearchTerms,
  createInitialCardsSearchState,
  useFileUpload,
  configureFileUploadErrorCapture,
  useGlobalDragDrop,
  useInfiniteScroll,
  useNetworkStatus,
  useObjectState,
} from "@teak/ui/hooks";
```

| Hook | Purpose |
|------|---------|
| `useCardActions` | Create / update / delete / favorite card mutations with optimistic updates |
| `useCardClipboard` | Copy card content (text, image URL, etc.) to the clipboard |
| `useCardModal` | Open and control the card detail modal |
| `useCardModalFilterActions` | Filter actions scoped to the card modal |
| `useCardQueryParamState` | Sync card query parameters with the URL |
| `useCardsSearchController` | Full search state machine — terms, filters, pagination |
| `useFileUpload` | File drag-and-drop / picker with upload progress |
| `useGlobalDragDrop` | App-level drag-and-drop context for card reordering |
| `useInfiniteScroll` | Intersection-observer-based infinite scroll trigger |
| `useNetworkStatus` | Online / offline network state |
| `useObjectState` | `useState` variant for partial object updates |

---

### Convex Query Cache Helpers

```tsx
import { ConvexQueryCacheProvider } from "@teak/ui/convex-query-cache";
import { useQuery } from "@teak/ui/convex-query-hooks";
```

Wrappers around `convex-helpers/react/cache` — use these instead of the raw Convex hooks to benefit from shared query caching across all surfaces.

---

### Utilities

```tsx
import { cn } from "@teak/ui/lib/utils";           // clsx + tailwind-merge
import { openCustomerPortal } from "@teak/ui/lib/customerPortal";
```

---

### Constants

```tsx
import { PRO_FEATURES, THEME_OPTIONS } from "@teak/ui/constants/settings";
import type { ThemeValue } from "@teak/ui/constants/settings";

import { TOAST_IDS, AUTH_STICKY_TOAST_OPTIONS } from "@teak/ui/constants/toast";
```

---

## Development

```bash
# Type-check
bun run typecheck --filter @teak/ui

# Tests
bun run test --filter @teak/ui
```

Tests live in `src/**/__tests__/` directories alongside their source files.
