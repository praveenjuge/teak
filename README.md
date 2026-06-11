# Teak

### Your personal knowledge hub for collecting, remembering, and rediscovering ideas.

Save inspiration in one click and find it in two seconds — no more lost bookmarks or messy folders. Teak runs everywhere you work: web, desktop, mobile, browser, and Raycast, with real-time sync across all of them.

[![Website](https://img.shields.io/badge/Website-teakvault.com-2563eb?style=for-the-badge)](https://teakvault.com)
[![Docs](https://img.shields.io/badge/Docs-Read-22c55e?style=for-the-badge)](https://teakvault.com/docs/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

![Teak](https://teakvault.com/hero-image.png)

<a href="https://vercel.com/oss">
  <img alt="Vercel OSS Program" src="https://vercel.com/oss/program-badge.svg" />
</a>

## Get Teak

| Platform | | |
|----------|---|---|
| 🌐 **Web** | Full dashboard with real-time sync | [Open app →](https://app.teakvault.com) |
| 🖥️ **Desktop** | Native macOS app with auto-updates | [Download →](https://github.com/praveenjuge/teak/releases/latest) |
| 📱 **iOS** | Save from anywhere via the share sheet | [App Store →](https://apps.apple.com/app/teak/id6738178801) |
| 🧩 **Browser** | One-click saves while you browse | [Chrome Web Store →](https://chromewebstore.google.com/detail/teak/negnmfifahnnagnbnfppmlgfajngdpob) |
| ⚡ **Raycast** | Save and search from your keyboard | [Install →](https://www.raycast.com/praveenjuge/teak-raycast) |
| 🔌 **API & MCP** | Programmatic and AI client access | [API docs →](https://teakvault.com/docs/api) |

## Monorepo

```text
teak/
├── apps/
│   ├── web/        # Next.js app
│   ├── api/        # Hono API gateway + MCP
│   ├── mobile/     # Expo app
│   ├── desktop/    # Electron desktop app
│   ├── extension/  # Browser extension (Wxt)
│   ├── safari-extension/ # Native macOS Safari extension app
│   ├── raycast/    # Raycast extension
│   └── docs/       # Documentation site (Astro + Starlight)
├── packages/
│   ├── convex/     # Convex backend
│   └── ui/         # Shared UI package
├── turbo.json      # Turborepo pipeline config
└── package.json
```

## Docs

[View docs →](https://teakvault.com/docs/)

## License

MIT License - see [LICENSE](LICENSE) file for details.
