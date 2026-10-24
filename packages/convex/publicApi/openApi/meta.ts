import { apiKeySecurity } from "./components";

export const metaPaths = {
  "/v1/oauth/disconnect": {
    post: {
      operationId: "disconnectOAuthConsent",
      summary: "Disconnect this WorkOS Connect application",
      description:
        "No request body. Revokes this application on all installations for the signed-in user, while other applications stay connected. Old consent receipts remain permanently denied and successful retries return 204 without revoking a later grant. Works after authentication rollback. Reconnect may wait up to 305 seconds while old access tokens expire. Preserve local credentials unless 204 is returned; refresh an expired access token after 401 and retry.",
      security: [{ connectRevocation: [] }],
      responses: {
        204: {
          description:
            "Application disconnected or completed old receipt replayed",
        },
        401: {
          description:
            "Invalid or expired token, or conflicting consent binding",
        },
        503: {
          description:
            "Disconnect pending or unavailable; preserve credentials and retry",
        },
      },
    },
  },
  "/v1/me": {
    get: {
      operationId: "getMe",
      summary: "Get the authenticated Teak identity",
      security: apiKeySecurity,
      responses: {
        200: {
          description: "Permanent Teak owner ID and current profile",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["data"],
                properties: {
                  data: {
                    type: "object",
                    required: ["id", "email", "locale"],
                    properties: {
                      id: {
                        type: "string",
                        description: "Permanent Teak owner ID",
                      },
                      email: { type: "string", format: "email" },
                      name: { type: "string" },
                      cardCount: {
                        type: "number",
                        description: "Cards outside Trash",
                      },
                      cardLimit: {
                        type: ["number", "null"],
                        description: "Free plan card limit; null on Pro",
                      },
                      plan: { enum: ["free", "pro"], type: "string" },
                      locale: {
                        type: "string",
                        description:
                          "The account's Teak language, chosen in Settings: a BCP 47 code such as en, de or pt-BR. More languages may be added, so treat an unknown code as English.",
                      },
                      settingsUrl: {
                        type: "string",
                        format: "uri",
                        description:
                          "Teak web Settings, where plan, billing, API keys and import live",
                      },
                    },
                  },
                },
              },
            },
          },
        },
        401: {
          description: "Missing, invalid, expired, or revoked credential",
        },
        429: { description: "Rate limit exceeded" },
        500: { description: "Profile or authorization service unavailable" },
      },
    },
  },
  "/healthz": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/HealthResponse" },
            },
          },
          description: "Service health",
        },
      },
      operationId: "getHealth",
      summary: "Health check",
    },
  },
  "/v1": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DiscoveryResponse" },
            },
          },
          description: "API discovery",
        },
      },
      operationId: "getApiDiscovery",
      summary: "List v1 endpoints",
    },
  },
} as const;
