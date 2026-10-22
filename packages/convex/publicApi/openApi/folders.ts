import {
  MAX_FOLDERS_PER_CARD,
  MAX_FOLDERS_PER_USER,
} from "../../shared/folders";
import { apiKeySecurity, folderIdParameters } from "./components";

export const folderPaths = {
  "/v1/folders": {
    get: {
      operationId: "listFolders",
      summary: "List folders",
      description: "Every folder in the account, sorted by name.",
      security: apiKeySecurity,
      responses: {
        200: {
          description: "Folders",
          content: {
            "application/json": {
              schema: {
                properties: {
                  items: {
                    items: { $ref: "#/components/schemas/Folder" },
                    type: "array",
                  },
                },
                required: ["items"],
                type: "object",
              },
            },
          },
        },
      },
    },
    post: {
      operationId: "createFolder",
      summary: "Create a folder",
      description: `An account can have up to ${MAX_FOLDERS_PER_USER} folders.`,
      security: apiKeySecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/FolderCreateRequest" },
          },
        },
      },
      responses: {
        201: {
          description: "Folder created",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Folder" },
            },
          },
        },
        400: { description: "Invalid name or color" },
        409: {
          description:
            "A folder with this name exists (`CONFLICT`) or the account has the most folders it can (`LIMIT_REACHED`)",
        },
      },
    },
  },
  "/v1/folders/{folderId}": {
    get: {
      operationId: "getFolder",
      parameters: folderIdParameters,
      summary: "Get a folder",
      security: apiKeySecurity,
      responses: {
        200: {
          description: "Folder",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Folder" },
            },
          },
        },
        404: { description: "Folder not found" },
      },
    },
    patch: {
      operationId: "updateFolder",
      parameters: folderIdParameters,
      summary: "Rename or recolor a folder",
      security: apiKeySecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/FolderUpdateRequest" },
          },
        },
      },
      responses: {
        200: {
          description: "Folder updated",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Folder" },
            },
          },
        },
        404: { description: "Folder not found" },
        409: { description: "A folder with this name exists" },
      },
    },
    delete: {
      operationId: "deleteFolder",
      parameters: folderIdParameters,
      summary: "Delete a folder",
      description:
        "Deletes the folder at once; its cards are kept and leave the folder shortly after.",
      security: apiKeySecurity,
      responses: {
        204: { description: "Folder deleted" },
        404: { description: "Folder not found" },
      },
    },
  },
  "/v1/folders/{folderId}/cards": {
    post: {
      operationId: "addCardsToFolder",
      parameters: folderIdParameters,
      summary: "Add cards to a folder",
      description: `Adding a card already in the folder succeeds without change. A card can be in up to ${MAX_FOLDERS_PER_CARD} folders.`,
      security: apiKeySecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/FolderCardsRequest" },
          },
        },
      },
      responses: {
        200: {
          description: "Per-card results",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/FolderCardsResult" },
            },
          },
        },
        404: { description: "Folder not found" },
        409: {
          description:
            "SMART_FOLDER: a smart folder shows the cards its search matches; cards cannot be added to it",
        },
      },
    },
    delete: {
      operationId: "removeCardsFromFolder",
      parameters: folderIdParameters,
      summary: "Remove cards from a folder",
      security: apiKeySecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/FolderCardsRequest" },
          },
        },
      },
      responses: {
        200: {
          description: "Per-card results",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/FolderCardsResult" },
            },
          },
        },
        404: { description: "Folder not found" },
        409: { description: "SMART_FOLDER: the folder is a smart folder" },
      },
    },
  },
} as const;
