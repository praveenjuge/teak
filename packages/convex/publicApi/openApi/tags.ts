import { apiKeySecurity } from "./components";
import type { OpenApiOperations } from "./operations";
import { requestBodySchema } from "./requestBodies";

export const tagOperations = {
  listTags: {
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
    summary: "List tags",
  },
  renameTag: {
    summary: "Rename a tag",
    description:
      "Renames a tag on every card. Renaming to a different casing of the same tag recases it. Returns at once; poll the operation for progress. One tag change runs at a time per account.",
    security: apiKeySecurity,
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: requestBodySchema("renameTag"),
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
  mergeTags: {
    summary: "Merge a tag into another",
    description:
      "Replaces a tag with another on every card; a card that has both keeps one. Returns at once; poll the operation for progress. One tag change runs at a time per account.",
    security: apiKeySecurity,
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: requestBodySchema("mergeTags"),
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
  deleteTag: {
    summary: "Delete a tag",
    description:
      "Removes a tag from every card. The cards are kept. Returns at once; poll the operation for progress. One tag change runs at a time per account.",
    security: apiKeySecurity,
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: requestBodySchema("deleteTag"),
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
  getTagOperation: {
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
} satisfies OpenApiOperations;
