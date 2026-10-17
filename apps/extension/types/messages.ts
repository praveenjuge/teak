import type { Platform } from "./social";

export const MESSAGE_TYPES = {
  RETRY_PENDING: "TEAK_RETRY_PENDING",
  DISCARD_PENDING: "TEAK_DISCARD_PENDING",
  SIGN_IN: "TEAK_SIGN_IN",
  SIGN_OUT: "TEAK_SIGN_OUT",
  SAVE_FILE: "TEAK_SAVE_FILE",
  GET_AUTH_STATE: "TEAK_GET_AUTH_STATE",
  SAVE_ASSET: "TEAK_SAVE_ASSET",
  SAVE_CONTENT: "TEAK_SAVE_CONTENT",
  SAVE_POST: "TEAK_SAVE_POST",
  PATCH_CARD: "TEAK_PATCH_CARD",
  LOAD_SAVE_DETAILS: "TEAK_LOAD_SAVE_DETAILS",
} as const;

export type SaveContentSource = "popup-auto-save" | "context-menu";

export interface GetAuthStateRequest {
  type: typeof MESSAGE_TYPES.GET_AUTH_STATE;
}

export interface SaveContentRequest {
  payload: {
    content: string;
    source: SaveContentSource;
  };
  type: typeof MESSAGE_TYPES.SAVE_CONTENT;
}

export interface SaveAssetRequest {
  payload: {
    assetUrl: string;
  };
  type: typeof MESSAGE_TYPES.SAVE_ASSET;
}

export interface SavePostRequest {
  payload: {
    platform: Platform;
    permalink: string;
    postKey: string;
  };
  type: typeof MESSAGE_TYPES.SAVE_POST;
}

/**
 * The popup's port to the background while it shows a card's tags and note.
 * It posts `{ draft }`, the change not yet saved (or null), on every edit;
 * when the popup closes, the port disconnects and the background sends the
 * last draft, which a message sent from a closing popup can't promise.
 */
export const SAVE_DETAILS_PORT = "teak-save-details";

export interface SaveDetailsDraftMessage {
  draft: PatchCardPayload | null;
}

/** The tags (replacing the card's own) and note the popup sets on a card. */
export interface PatchCardPayload {
  /** Tags in `tags` that this change adds, which the extension remembers as recent. */
  added?: string[];
  cardId: string;
  notes?: string | null;
  tags?: string[];
}

export interface PatchCardRequest {
  payload: PatchCardPayload;
  type: typeof MESSAGE_TYPES.PATCH_CARD;
}

export interface LoadSaveDetailsRequest {
  /** True for a page that was already saved: its tags and note load too. */
  payload: { cardId: string; existing: boolean };
  type: typeof MESSAGE_TYPES.LOAD_SAVE_DETAILS;
}

export type TeakRuntimeRequest =
  | {
      type:
        | typeof MESSAGE_TYPES.SIGN_IN
        | typeof MESSAGE_TYPES.SIGN_OUT
        | typeof MESSAGE_TYPES.RETRY_PENDING
        | typeof MESSAGE_TYPES.DISCARD_PENDING;
    }
  | { type: typeof MESSAGE_TYPES.SAVE_FILE; payload: { id: string } }
  | GetAuthStateRequest
  | SaveAssetRequest
  | SaveContentRequest
  | SavePostRequest
  | PatchCardRequest
  | LoadSaveDetailsRequest;

export interface AuthStateResponse {
  authenticated: boolean;
  pending?: boolean;
  pendingCount?: number;
  user?: { id: string; email: string; name?: string };
}

export interface SaveSuccessResponse {
  cardId: string;
  status: "saved";
}

export interface SaveDuplicateResponse {
  cardId?: string;
  status: "duplicate";
}

export interface SaveUnauthenticatedResponse {
  status: "unauthenticated";
}

export interface SaveErrorResponse {
  code?: string;
  message: string;
  status: "error";
}

export type TeakSaveResponse =
  | SaveSuccessResponse
  | SaveDuplicateResponse
  | SaveUnauthenticatedResponse
  | SaveErrorResponse;

export type CardPatchResponse =
  | { status: "updated" }
  | SaveUnauthenticatedResponse
  | SaveErrorResponse;

export type SaveDetailsResponse =
  | {
      /** The card's own tags and note; only for a page already saved. */
      card?: { notes: string; tags: string[] };
      /** The library's most used tags, most used first. */
      libraryTags: string[];
      status: "ok";
    }
  | SaveUnauthenticatedResponse
  | SaveErrorResponse;
