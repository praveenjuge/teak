# Teak

### Your personal knowledge hub for collecting, remembering, and rediscovering ideas.

Save inspiration in one click and find it in two seconds — no more lost bookmarks or messy folders. Teak runs everywhere you work: web, Mac, mobile, browser, Raycast, and the command line, with real-time sync across all of them.

[![Website](https://img.shields.io/badge/Website-teakvault.com-2563eb?style=for-the-badge)](https://teakvault.com)
[![Docs](https://img.shields.io/badge/Docs-Read-22c55e?style=for-the-badge)](https://teakvault.com/docs/)
[![Agent Skill](https://img.shields.io/badge/Skills.sh-Teak-111827?style=for-the-badge)](https://skills.sh/praveenjuge/teak)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

![Teak](https://teakvault.com/hero-image.png)

<a href="https://vercel.com/oss">
  <img alt="Vercel OSS Program" src="https://vercel.com/oss/program-badge.svg" />
</a>

## Get Teak

| Platform | | |
|----------|---|---|
| 🌐 **Web** | Full dashboard with real-time sync | [Open app →](https://app.teakvault.com) |
| 🖥️ **Mac** | Native library, capture, and Safari saves | [Mac App Store →](https://apps.apple.com/us/app/teak-save-inspirations/id6756574989?mt=12) |
| 📱 **iOS** | Save from anywhere via the share sheet | [App Store →](https://apps.apple.com/us/app/teak-save-inspirations/id6756574989) |
| 🧩 **Browser** | One-click saves while you browse | [Chrome →](https://chromewebstore.google.com/detail/teak/negnmfifahnnagnbnfppmlgfajngdpob) |
| ⚡ **Raycast** | Save and search from your keyboard | [Install →](https://www.raycast.com/praveenjuge/teak-raycast) |
| 🧰 **CLI** | Save, search, and manage cards from your terminal | `npm i -g teak-cli` |
| 🤖 **Agent Skill** | Teach AI agents how to use Teak through CLI, API, MCP, and SDK workflows | [Skills.sh](https://skills.sh/praveenjuge/teak) · `npx skills add praveenjuge/teak --skill teak` |
| 🔌 **API & MCP** | Programmatic and AI client access | [API docs →](https://teakvault.com/docs/api) |

## Monorepo

```text
teak/
├── apps/
│   ├── web/           # Next.js web app
│   ├── apple/         # Native iPhone, iPad and Mac app with its Safari extension
│   ├── android/       # Native Android app
│   ├── extension/     # Chrome and Firefox extension (WXT)
│   ├── raycast/       # Raycast extension
│   ├── cli/           # npm command line client
│   ├── docs/          # Website and documentation (Blume)
│   └── core-worker/   # Cloudflare Worker for files, card processing, Save by email and the API edge proxy
├── packages/
│   ├── convex/        # Convex backend, public API and MCP server
│   ├── files-protocol/ # Contract between Convex and the Core Worker
│   ├── sdk/           # teak-sdk, the public TypeScript client
│   ├── i18n/          # Message catalogs for the web app and extension
│   └── tests/         # End-to-end suite
└── .agents/           # Guides and skills for coding agents
```

How the pieces fit together: [Architecture](https://teakvault.com/docs/architecture).

## Docs

[View docs →](https://teakvault.com/docs/) · [Local development →](https://teakvault.com/docs/development) · [Testing →](https://teakvault.com/docs/testing) · [Self-hosting →](https://teakvault.com/docs/self-hosting)

## License

MIT License - see [LICENSE](LICENSE) file for details.
