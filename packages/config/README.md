# @teak/config

Shared configuration helpers for Teak — dev URL resolution and local-development detection used across all apps and the Convex backend.

## Installation

This is a private workspace package. Add it as a dependency in any Teak app:

```bash
bun add @teak/config --filter @teak/your-app
```

## Usage

### Dev URL resolution

Resolves the three canonical local-development base URLs. Each function reads the matching environment variable and falls back to the built-in default.

```ts
import {
  resolveTeakDevAppUrl,
  resolveTeakDevApiUrl,
  resolveTeakDevDocsUrl,
} from "@teak/config";

const appUrl  = resolveTeakDevAppUrl(process.env);  // TEAK_DEV_APP_URL
const apiUrl  = resolveTeakDevApiUrl(process.env);  // TEAK_DEV_API_URL
const docsUrl = resolveTeakDevDocsUrl(process.env); // TEAK_DEV_DOCS_URL
```

**Default values** (used when the environment variable is absent or empty):

| Constant | Value |
|---|---|
| `DEFAULT_TEAK_DEV_APP_URL` | `http://app.teak.localhost:1355` |
| `DEFAULT_TEAK_DEV_API_URL` | `http://api.teak.localhost:1355` |
| `DEFAULT_TEAK_DEV_DOCS_URL` | `http://docs.teak.localhost:1355` |

Each resolver strips path, query, and hash from the supplied value, so trailing slashes and sub-paths are safe to pass in.

### Local-development detection

```ts
import { isLocalDevelopmentHostname, isLocalDevelopmentUrl } from "@teak/config";

isLocalDevelopmentHostname("app.teak.localhost"); // true
isLocalDevelopmentHostname("app.teakvault.com");  // false

isLocalDevelopmentUrl("http://app.teak.localhost:1355"); // true
isLocalDevelopmentUrl("https://app.teakvault.com");      // false
```

Recognized as local: `localhost`, `127.0.0.1`, and any `*.localhost` hostname.

### `DevUrlEnv` type

```ts
import type { DevUrlEnv } from "@teak/config";
```

Minimal environment-object shape accepted by the resolver functions. Use it to pass `process.env` or a typed subset:

```ts
const env: DevUrlEnv = {
  TEAK_DEV_APP_URL: process.env.TEAK_DEV_APP_URL,
};
```

## Sub-path import

The package also exposes a named sub-path for tree-shaking:

```ts
import { resolveTeakDevAppUrl } from "@teak/config/dev-urls";
```
