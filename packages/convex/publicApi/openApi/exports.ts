import { apiKeySecurity } from "./components";

export const exportPaths = {
  "/v1/exports": {
    post: {
      operationId: "startExport",
      summary: "Start a ZIP export of every card and original file",
      description:
        "One export can run at a time, and one can be started every 7 days. Poll GET /v1/exports/latest for progress and the download URL. The ZIP holds manifest.json, cards.json, the original files under files/, bookmarks.html (Netscape bookmark format) and cards.csv. manifest.json reports `schemaVersion: 2`: each card in cards.json also has `aiTags`, `aiSummary`, `metadataTitle`, `isArchived` and `folders` (names). A card saved from a page also has `sourceUrl` and `sourceTitle`.",
      security: apiKeySecurity,
      responses: {
        202: {
          description: "Export started",
          content: {
            "application/json": {
              schema: {
                properties: {
                  job: { $ref: "#/components/schemas/ExportJob" },
                },
                required: ["job"],
                type: "object",
              },
            },
          },
        },
        409: {
          description: "An export is already running; body includes `job`",
        },
        429: {
          description:
            "An export already ran in the last 7 days; `retryAt` and Retry-After say when the next can start",
        },
      },
    },
  },
  "/v1/exports/latest": {
    get: {
      operationId: "getLatestExport",
      summary: "Get the latest export and its download URL",
      security: apiKeySecurity,
      responses: {
        200: {
          description: "Latest export, or null if there has never been one",
          content: {
            "application/json": {
              schema: {
                properties: {
                  job: {
                    oneOf: [
                      { $ref: "#/components/schemas/ExportJob" },
                      { type: "null" },
                    ],
                  },
                  canStartNew: { type: "boolean" },
                  nextAvailableAt: {
                    description:
                      "When the next export can start, or null if one can start now",
                    type: ["number", "null"],
                  },
                },
                required: ["job", "canStartNew", "nextAvailableAt"],
                type: "object",
              },
            },
          },
        },
      },
    },
  },
} as const;
