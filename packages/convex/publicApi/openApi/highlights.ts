import { MAX_HIGHLIGHTS_PER_CARD } from "../../shared/highlights/constants";
import { apiErrorContent, apiKeySecurity, cardIdParameter } from "./components";

const highlightIdParameters = [
  {
    in: "path",
    name: "highlightId",
    required: true,
    schema: { type: "string" },
  },
];

const highlightContent = {
  "application/json": { schema: { $ref: "#/components/schemas/Highlight" } },
} as const;

export const highlightPaths = {
  "/v1/cards/{cardId}/highlights": {
    get: {
      operationId: "listHighlights",
      parameters: [cardIdParameter],
      summary: "List a card's highlights",
      description:
        "Passages highlighted in a link's article, in the order they appear in it; ones not found in the saved article come last.",
      security: apiKeySecurity,
      responses: {
        200: {
          description: "Highlights",
          content: {
            "application/json": {
              schema: {
                properties: {
                  items: {
                    items: { $ref: "#/components/schemas/Highlight" },
                    type: "array",
                  },
                },
                required: ["items"],
                type: "object",
              },
            },
          },
        },
        404: { content: apiErrorContent, description: "Card not found" },
      },
    },
    post: {
      operationId: "createHighlight",
      parameters: [cardIdParameter],
      summary: "Highlight a passage",
      description: `Finds the quote in the card's saved article and highlights it: the first match, unless \`prefix\` or \`suffix\` points at another. A passage that overlaps a highlight merges with it, keeping the older note. A card holds up to ${MAX_HIGHLIGHTS_PER_CARD} highlights, and a highlighted link keeps its saved copy and article: Refresh details and saving it again no longer replace them.`,
      security: apiKeySecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/HighlightCreateRequest" },
          },
        },
      },
      responses: {
        200: {
          content: highlightContent,
          description:
            "The passage was highlighted already, or the new highlight merged with one it overlapped",
        },
        201: { content: highlightContent, description: "Highlight created" },
        400: {
          content: apiErrorContent,
          description: "INVALID_INPUT: no quote, or a quote or note too long",
        },
        404: { content: apiErrorContent, description: "Card not found" },
        409: {
          content: apiErrorContent,
          description: `NO_ARTICLE: the card isn't a link with a saved article, or is in Trash. HIGHLIGHT_LIMIT: the card has ${MAX_HIGHLIGHTS_PER_CARD} highlights. CONFLICT: the card's saved article changed while the quote was being found; try again`,
        },
        422: {
          content: apiErrorContent,
          description: "QUOTE_NOT_FOUND: the article doesn't have the quote",
        },
        429: { content: apiErrorContent, description: "RATE_LIMITED" },
      },
    },
  },
  "/v1/highlights/{highlightId}": {
    patch: {
      operationId: "updateHighlight",
      parameters: highlightIdParameters,
      summary: "Change a highlight's note",
      security: apiKeySecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/HighlightUpdateRequest" },
          },
        },
      },
      responses: {
        200: { content: highlightContent, description: "Highlight updated" },
        400: {
          content: apiErrorContent,
          description: "INVALID_INPUT: no note, or a note too long",
        },
        404: { content: apiErrorContent, description: "Highlight not found" },
        429: { content: apiErrorContent, description: "RATE_LIMITED" },
      },
    },
    delete: {
      operationId: "deleteHighlight",
      parameters: highlightIdParameters,
      summary: "Remove a highlight",
      description:
        "A link whose last highlight goes is no longer frozen: Refresh details replaces its saved copy and article again.",
      security: apiKeySecurity,
      responses: {
        204: { description: "Highlight removed" },
        404: { content: apiErrorContent, description: "Highlight not found" },
        429: { content: apiErrorContent, description: "RATE_LIMITED" },
      },
    },
  },
} as const;
