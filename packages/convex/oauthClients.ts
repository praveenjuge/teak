import { v } from "convex/values";
import { components } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";

// In better-auth 1.6.11 the `mcp` plugin resolves OAuth clients ONLY from the
// `oauthApplication` table on both `/mcp/authorize` and `/mcp/token`; it does
// NOT consult `oidcConfig.trustedClients` (that option only affects the
// oidc-provider endpoints, which the mcp plugin does not expose). Our
// first-party public clients must therefore exist as rows. This seed keeps them
// present and in sync; it runs on a cron and can be invoked manually via
// `bunx convex run oauthClients:ensureOAuthClients`.

interface OAuthClientSeed {
  clientId: string;
  name: string;
  redirectUrls: string[];
}

// Keep in sync with the trusted clients declared in `auth.ts`. Redirect URIs
// are matched by EXACT string equality by the plugin, so every value a client
// may send must appear verbatim here.
export const FIRST_PARTY_OAUTH_CLIENTS: OAuthClientSeed[] = [
  {
    clientId: "teak-raycast",
    name: "Raycast",
    redirectUrls: [
      "https://raycast.com/redirect?packageName=Extension",
      "https://raycast.com/redirect/extension",
      "https://raycast.com/redirect",
      "raycast://oauth?package_name=teak",
    ],
  },
  {
    clientId: "teak-desktop",
    name: "Teak Desktop",
    redirectUrls: [
      "http://127.0.0.1:14203/oauth/callback",
      "http://127.0.0.1:24203/oauth/callback",
    ],
  },
  {
    clientId: "teak-cli",
    name: "Teak CLI",
    redirectUrls: [
      "http://127.0.0.1:14210/oauth/callback",
      "http://127.0.0.1:24210/oauth/callback",
    ],
  },
];

const findOAuthApplication = (ctx: MutationCtx, clientId: string) =>
  ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "oauthApplication",
    where: [{ field: "clientId", operator: "eq", value: clientId }],
  });

export const ensureOAuthClients = internalMutation({
  args: {},
  returns: v.object({
    clients: v.array(
      v.object({ clientId: v.string(), redirectUrls: v.string() })
    ),
    created: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx) => {
    let created = 0;
    let updated = 0;
    const now = Date.now();

    for (const client of FIRST_PARTY_OAUTH_CLIENTS) {
      const existing = await findOAuthApplication(ctx, client.clientId);

      // Public clients: no secret. redirectUrls is stored as a comma-joined
      // string (the plugin splits on ",") and must match the redirect_uri sent
      // by the client via exact string equality. `clientId` is the immutable
      // identity, so it is only set on create — never in the update payload.
      const mutableFields = {
        clientSecret: "",
        disabled: false,
        metadata: null,
        name: client.name,
        redirectUrls: client.redirectUrls.join(","),
        type: "public",
        updatedAt: now,
        userId: null,
      };

      if (existing) {
        await ctx.runMutation(components.betterAuth.adapter.updateOne, {
          input: {
            model: "oauthApplication",
            update: mutableFields,
            where: [
              { field: "clientId", operator: "eq", value: client.clientId },
            ],
          },
        });
        updated += 1;
      } else {
        await ctx.runMutation(components.betterAuth.adapter.create, {
          input: {
            model: "oauthApplication",
            data: {
              ...mutableFields,
              clientId: client.clientId,
              createdAt: now,
            },
          },
        });
        created += 1;
      }
    }

    // Return the final redirect URLs so a manual run is self-verifying.
    return {
      clients: FIRST_PARTY_OAUTH_CLIENTS.map((client) => ({
        clientId: client.clientId,
        redirectUrls: client.redirectUrls.join(","),
      })),
      created,
      updated,
    };
  },
});

// Read-only inspector: shows what is actually stored for each first-party
// client. Run via `bunx convex run oauthClients:debugOAuthClients`.
export const debugOAuthClients = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      clientId: v.string(),
      disabled: v.union(v.boolean(), v.null()),
      found: v.boolean(),
      redirectUrls: v.union(v.string(), v.null()),
      type: v.union(v.string(), v.null()),
    })
  ),
  handler: async (ctx) => {
    const results: Array<{
      clientId: string;
      disabled: boolean | null;
      found: boolean;
      redirectUrls: string | null;
      type: string | null;
    }> = [];

    for (const client of FIRST_PARTY_OAUTH_CLIENTS) {
      const row = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "oauthApplication",
        where: [{ field: "clientId", operator: "eq", value: client.clientId }],
      })) as {
        disabled?: boolean | null;
        redirectUrls?: string | null;
        type?: string | null;
      } | null;

      results.push({
        clientId: client.clientId,
        disabled: row?.disabled ?? null,
        found: Boolean(row),
        redirectUrls: row?.redirectUrls ?? null,
        type: row?.type ?? null,
      });
    }

    return results;
  },
});
