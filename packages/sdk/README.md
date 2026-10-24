# Teak SDK

Typed API client and OAuth discovery for [Teak](https://teakvault.com). One
bundle with no runtime dependencies.

```bash
npm i teak-sdk
```

```ts
import { createTeakClient, staticTokenProvider } from "teak-sdk";

const client = createTeakClient({
  baseUrl: "https://teakvault.com/api",
  tokenProvider: staticTokenProvider(process.env.TEAK_API_KEY!),
});

await client.cards.create({ content: "A note from my script" });
```

The guide, with token providers and WorkOS Connect sign-in, is at
[teakvault.com/docs/sdk](https://teakvault.com/docs/sdk). Each release shares
the lockstep version of the other Teak products.
