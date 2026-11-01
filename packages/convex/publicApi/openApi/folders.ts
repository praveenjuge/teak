import {
  MAX_FOLDERS_PER_CARD,
  MAX_FOLDERS_PER_USER,
} from "../../shared/folders";
import { apiKeySecurity, folderIdParameters } from "./components";

const ruleRunParameters = [
  ...folderIdParameters,
  {
    in: "path",
    name: "runId",
    required: true,
    schema: { type: "string" },
  },
];

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
            "A folder with this name exists (`CONFLICT`), the account has the most folders it can (`LIMIT_REACHED`), or the most folders with rules (`RULE_LIMIT`)",
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
      summary: "Rename, recolor or change the rules of a folder",
      description:
        "Saving new auto-tags, or a new or resumed auto-file search, starts a rule run over the cards already in the library; the response's `ruleRunId` names it.",
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
        409: {
          description:
            "A folder with this name exists (`CONFLICT`) or the account has rules on the most folders it can (`RULE_LIMIT`)",
        },
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
  "/v1/folders/{folderId}/rule-runs/{runId}": {
    get: {
      operationId: "getFolderRuleRun",
      parameters: ruleRunParameters,
      summary: "Get a folder rule run",
      description:
        "How far a pass of the folder's rules over the library has got, and whether it can still be undone.",
      security: apiKeySecurity,
      responses: {
        200: {
          description: "Rule run",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/FolderRuleRun" },
            },
          },
        },
        404: { description: "Folder or rule run not found" },
      },
    },
  },
  "/v1/folders/{folderId}/rule-runs/{runId}/undo": {
    post: {
      operationId: "undoFolderRuleRun",
      parameters: ruleRunParameters,
      summary: "Undo a folder rule run",
      description:
        "Takes the folder off the cards the run filed and the tags off the cards it tagged, where they are still there. The rules stay, and never put those cards or tags back.",
      security: apiKeySecurity,
      responses: {
        200: {
          description: "The run, now undoing",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/FolderRuleRun" },
            },
          },
        },
        404: { description: "Folder or rule run not found" },
        409: { description: "The run is more than a day old" },
      },
    },
  },
} as const;
