# Teak

Teak is a streamlined personal knowledge hub designed to help creative minds effortlessly collect, remember, and rediscover their most important ideas and inspirations.

- **Runtime**: Bun
- **Backend**: Hono.js API server (@teak/backend)
- **Web App**: React 19 + Vite (@teak/web)
- **Mobile App**: React Native with Expo (@teak/mobile)
- **Database**: PostgreSQL 17 with Drizzle ORM
- **Containerization**: Docker

## 📁 Project Structure

```
teak/
├── apps/
│   ├── backend/             # Backend API server (@teak/backend)
│   │   ├── src/
│   │   │   ├── index.ts     # Hono.js server entry point
│   │   │   ├── routes/      # API route handlers
│   │   │   ├── services/    # Business logic services
│   │   │   ├── db/          # Database schema & connection
│   │   │   └── auth.ts      # Better Auth configuration
│   ├── web/                 # React 19 frontend (@teak/web)
│   └── mobile/              # React Native Expo mobile app (@teak/mobile)
├── docker/                  # Docker configurations
├── scripts/                 # Utility & bootstrap scripts
├── postman/                 # API testing collection
├── .env.example             # Environment variables template
├── package.json             # Root monorepo orchestrator (@teak/root)
└── README.md                # This file
```

## 🚀 Getting Started

For detailed development setup, environment configuration, and comprehensive documentation, visit our documentation site:

**📖 [Development Guide](https://teakvault.com/docs/development)** - Complete setup instructions, commands, and workflow

**⚙️ [Environment Settings](https://teakvault.com/docs/environment-settings)** - Configuration variables and environment setup

## 📄 License

MIT License - see LICENSE file for details.
