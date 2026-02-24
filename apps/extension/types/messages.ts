import type { Platform } from "./social";

export const MESSAGE_TYPES = {
  GET_AUTH_STATE: "TEAK_GET_AUTH_STATE",
  SAVE_CONTENT: "TEAK_SAVE_CONTENT",
  SAVE_POST: "TEAK_SAVE_POST",
} as const;

export type TeakMessageType =
  (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

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
  | SaveContentRequest
  | SavePostRequest;

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
