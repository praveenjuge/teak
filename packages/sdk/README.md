# Teak SDK

Typed API client and OAuth discovery for Teak. The distribution bundles the
canonical implementation from `packages/convex/client/sdk.ts`; it has no runtime
dependencies and works without the Teak monorepo.

```ts
import { createTeakClient, discoverAuthServer } from "teak-sdk";

const auth = await discoverAuthServer("https://teakvault.com/api");
const client = createTeakClient({
  baseUrl: "https://teakvault.com/api",
  tokenProvider: { getAccessToken: () => yourStoredAccessToken },
});
```

Use the discovered endpoints and client ID for your OAuth surface. Refresh
discovery after sign-in or refresh failures. Keep tokens in your platform's secure
storage; this package does not store credentials or open a browser.

This package is prepared for the WorkOS migration and is not published yet.
Publication requires lockstep release preparation and npm publisher setup.
