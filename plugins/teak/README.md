# Teak for Claude

Teak is a personal knowledge hub for saving and rediscovering links, images, videos, audio, documents, notes, quotes and color palettes. This plugin connects Claude to your Teak library through Teak's remote MCP server, so you can save things while you talk with Claude and find them again later.

## Features

- **Search your library** by words, meaning and qualifiers such as `tag:design`, `type:link`, `site:github.com` and `is:fav`.
- **Save** links, notes and quotes, with tags. Saving a link you already have moves it to the top instead of making a copy.
- **Organize** cards with tags, folders, favorites and archive.
- **See your cards**: in Claude apps that show MCP Apps, searches and saves appear as a card grid with images, palettes and links back to Teak.
- **Commands**: `/teak:save`, `/teak:search` and `/teak:recent`.
- **A skill** that teaches Claude which Teak tool fits each request, and to ask before deleting anything.

## Installation

In Claude Code:

```text
/plugin marketplace add praveenjuge/teak
/plugin install teak@teak
```

You can also add Teak to claude.ai, Claude Desktop or Claude mobile from the connectors directory, or as a custom connector with the URL `https://teakvault.com/mcp`.

## Configuration

There is nothing to configure. The first time Claude calls a Teak tool, your browser opens Teak's sign-in page; approve the connection there. You can revoke it any time in Teak under Settings → Security → Connected apps. You need a Teak account; the free plan holds 200 cards.

## Examples

1. "Save https://www.smashingmagazine.com/2024/05/variable-fonts/ to Teak with the tag typography."
2. "What did I save about onboarding flows last month?"
3. "/teak:search tag:inspiration type:image"
4. "Show my favorite color palettes and suggest one for a calm dashboard."
5. "/teak:recent 20", then "Put the three design articles into a folder called Redesign."

## What the plugin sends and runs

The plugin runs no local code. It points Claude at one remote MCP server, `https://teakvault.com/mcp`, which Teak operates. Claude sends that server the tool calls you ask for (searches, saves and edits) with your Teak sign-in token. Card images shown in Claude load from `files.teakvault.com`. Nothing is sent anywhere else.

## Privacy Policy

Teak's [privacy policy](https://teakvault.com/docs/privacy-policy) covers what Teak stores, how long it keeps it, who it shares it with, and how to delete your account. Questions: hello@praveenjuge.com.

## Support

Email hello@praveenjuge.com or open an issue at https://github.com/praveenjuge/teak/issues. Docs: https://teakvault.com/docs/mcp.

## License

MIT
