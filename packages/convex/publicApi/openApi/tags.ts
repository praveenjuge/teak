import { MAX_TAG_KEY_LENGTH, MAX_TAG_NAME_LENGTH } from "../../shared/tags";
import { apiKeySecurity } from "./components";

export const tagPaths = {
  "/v1/tags": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TagsResponse" },
            },
          },
          description: "Tag summary list",
        },
      },
      security: apiKeySecurity,
      operationId: "listTags",
      summary: "List tags",
    },
  },
  "/v1/tags/rename": {
    post: {
      operationId: "renameTag",
      summary: "Rename a tag",
      description:
        "Renames a tag on every card. Renaming to a different casing of the same tag recases it. Returns at once; poll the operation for progress. One tag change runs at a time per account.",
      security: apiKeySecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              properties: {
                from: {
                  description: "The tag to rename, matched ignoring case.",
                  maxLength: MAX_TAG_KEY_LENGTH,
                  type: "string",
                },
                to: {
                  description: "The new name, written exactly as given.",
                  maxLength: MAX_TAG_NAME_LENGTH,
                  type: "string",
                },
              },
              required: ["from", "to"],
              type: "object",
            },
          },
        },
      },
      responses: {
        202: {
          description: "Tag change started",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TagOperationStarted" },
            },
          },
        },
        400: { description: "Invalid tag name" },
        404: { description: "No card has the tag" },
        409: {
          description:
            "Another tag change is still running (`TAG_OPERATION_RUNNING`) or a tag with the new name exists (`TAG_EXISTS`; merge into it instead)",
        },
      },
    },
  },
  "/v1/tags/merge": {
    post: {
      operationId: "mergeTags",
      summary: "Merge a tag into another",
      description:
        "Replaces a tag with another on every card; a card that has both keeps one. Returns at once; poll the operation for progress. One tag change runs at a time per account.",
      security: apiKeySecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              properties: {
                from: {
                  description: "The tag to merge away, matched ignoring case.",
                  maxLength: MAX_TAG_KEY_LENGTH,
                  type: "string",
                },
                into: {
                  description: "The tag to keep.",
                  maxLength: MAX_TAG_NAME_LENGTH,
                  type: "string",
                },
              },
              required: ["from", "into"],
              type: "object",
            },
          },
        },
      },
      responses: {
        202: {
          description: "Tag change started",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TagOperationStarted" },
            },
          },
        },
        400: { description: "Invalid tag name" },
        404: { description: "No card has the tag" },
        409: {
          description:
            "Another tag change is still running (`TAG_OPERATION_RUNNING`)",
        },
      },
    },
  },
  "/v1/tags/delete": {
    post: {
      operationId: "deleteTag",
      summary: "Delete a tag",
      description:
        "Removes a tag from every card. The cards are kept. Returns at once; poll the operation for progress. One tag change runs at a time per account.",
      security: apiKeySecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              properties: {
                tag: {
                  description: "The tag to delete, matched ignoring case.",
                  maxLength: MAX_TAG_KEY_LENGTH,
                  type: "string",
                },
              },
              required: ["tag"],
              type: "object",
            },
          },
        },
      },
      responses: {
        202: {
          description: "Tag change started",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TagOperationStarted" },
            },
          },
        },
        400: { description: "Invalid tag name" },
        404: { description: "No card has the tag" },
        409: {
          description:
            "Another tag change is still running (`TAG_OPERATION_RUNNING`)",
        },
      },
    },
  },
  "/v1/tags/operations/{operationId}": {
    get: {
      operationId: "getTagOperation",
      parameters: [
        {
          in: "path",
          name: "operationId",
          required: true,
          schema: { type: "string" },
        },
      ],
      summary: "Get a tag change's progress",
      security: apiKeySecurity,
      responses: {
        200: {
          description: "Tag operation",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TagOperation" },
            },
          },
        },
        404: { description: "Tag operation not found" },
      },
    },
  },
} as const;
