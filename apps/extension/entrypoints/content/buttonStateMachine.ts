import type { TeakSaveResponse } from "../../types/messages";

export type ButtonState = "duplicate" | "error" | "idle" | "saved" | "saving";

export const shouldAllowClick = (state: ButtonState): boolean =>
  state !== "saving" && state !== "saved" && state !== "duplicate";

export const mapSaveResponseToButtonState = (
  response: TeakSaveResponse
): ButtonState => {
  if (response.status === "saved") {
    return "saved";
  }

  if (response.status === "duplicate") {
    return "duplicate";
  }

  return "error";
};
