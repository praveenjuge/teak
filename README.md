# Teak

Teak is a personal knowledge hub designed to help creative minds effortlessly collect, remember, and rediscover their most important ideas and inspirations.

<br />
<a href="https://vercel.com/oss">
  <img alt="Vercel OSS Program" src="https://vercel.com/oss/program-badge.svg" />
</a>

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

MIT License - see LICENSE file for details.
