import type { Platform } from "./social";

export const MESSAGE_TYPES = {
  GET_AUTH_STATE: "TEAK_GET_AUTH_STATE",
  SAVE_ASSET: "TEAK_SAVE_ASSET",
  SAVE_CONTENT: "TEAK_SAVE_CONTENT",
  SAVE_POST: "TEAK_SAVE_POST",
  // Fired by the content script on the /native/auth/complete page once the
  // browser sign-in handoff finishes, so the background can poll immediately.
  NATIVE_AUTH_COMPLETED: "TEAK_NATIVE_AUTH_COMPLETED",
  // Sent by the popup (on open with a pending flow) asking the background to
  // run a single poll and report the resulting auth state.
  POLL_NATIVE_AUTH: "TEAK_POLL_NATIVE_AUTH",
} as const;

export type TeakMessageType =
  (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

export type SaveContentSource = "popup-auto-save" | "context-menu";

export interface GetAuthStateRequest {
  type: typeof MESSAGE_TYPES.GET_AUTH_STATE;
}

export interface NativeAuthCompletedRequest {
  payload: {
    state: string;
  };
  type: typeof MESSAGE_TYPES.NATIVE_AUTH_COMPLETED;
}

export interface PollNativeAuthRequest {
  type: typeof MESSAGE_TYPES.POLL_NATIVE_AUTH;
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

export type TeakRuntimeRequest =
  | GetAuthStateRequest
  | SaveAssetRequest
  | SaveContentRequest
  | SavePostRequest
  | NativeAuthCompletedRequest
  | PollNativeAuthRequest;

export interface AuthStateResponse {
  authenticated: boolean;
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
