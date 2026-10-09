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

Use the discovered endpoints and client ID for your OAuth surface. The WorkOS
Connect helpers (`createPkceChallenge`, `createConnectAuthorizeUrl`,
`requestConnectTokens`, `fetchConnectOwnerId`, `disconnectConnectGrant`) cover
PKCE sign-in, refresh, account binding and disconnect. Refresh
discovery after sign-in or refresh failures. Keep tokens in your platform's secure
storage; this package does not store credentials or open a browser.

The optional `TokenProvider.onUnauthorized(rejectedToken: string)` callback receives
the token used by a retry-eligible 401 response. Return a new or already-refreshed
token to retry once, or `null` to stop. Check the rejected token against the current
session before refreshing so an older response cannot invalidate newer credentials.

Install it from npm as `teak-sdk`. Each release shares the lockstep version of
the other Teak products and is published by the `SDK Release` workflow.
