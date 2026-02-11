# Teak Raycast Extension

Keyboard-first Teak workflows for capture and retrieval directly inside Raycast.

## Features

- `Quick Save`: Save text or URLs to Teak without context switching.
- `Search Cards`: Search across Teak card content, tags, and metadata.
- `Favorites`: Open and copy from your favorited cards.

## Prerequisites

- Raycast on macOS
- Teak account
- Active Teak API key from `https://app.teakvault.com/settings`

## Setup

1. Install the extension from the Raycast Store search page: <https://www.raycast.com/store?query=teak>
2. In Teak web settings, generate a Raycast API key.
3. In Raycast, open extension preferences and paste the API key.

## Development

```bash
# From repo root
bun run dev:raycast

# From apps/raycast
bun run dev
```

## Quality Gates

Run these before every publish:

```bash
cd /Users/praveenjuge/Projects/teak/apps/raycast
bun run lint
bun run typecheck
bun run test
bun run build
```

## Release Commands

```bash
# Repo root convenience command
bun run publish:raycast

# Or from app folder
cd /Users/praveenjuge/Projects/teak/apps/raycast
bun run publish
```

## Store Listing Draft

- Subtitle: Save and search your Teak ideas from Raycast.
- Short description: Capture notes and URLs, search your entire Teak vault, and open favorites instantly.
- Full description:
  Teak for Raycast helps you stay in flow while capturing and rediscovering ideas. Quick Save stores text or links in seconds, Search Cards finds anything across your vault, and Favorites gives you instant access to your highest-signal references. Authenticate once with your Teak API key and keep your capture workflow fully keyboard driven.

## Screenshot Checklist

Capture these for Store submission:

1. Quick Save with successful save toast.
2. Search Cards with populated results and card detail action panel.
3. Favorites command with populated favorites list.

## Troubleshooting

- Invalid key errors: regenerate key in Teak Settings > API Keys, then update extension preferences.
- Rate limited errors: wait briefly and retry.
- Network errors: verify connectivity to `app.teakvault.com` and Convex endpoints.
