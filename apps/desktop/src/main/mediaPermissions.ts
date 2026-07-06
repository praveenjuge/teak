// Media permission predicates for the Electron main process.
//
// Teak's only use of `getUserMedia` is recording audio notes
// (`getUserMedia({ audio: true })`), so the desktop app must grant the
// microphone and nothing else. Electron's single `media` permission covers
// both the microphone and the camera, so approving every `media` request would
// silently grant camera access too. These predicates inspect the requested
// media type(s) and approve audio-only access.
//
// They are intentionally free of Electron imports so they can be unit tested
// without the Electron runtime.

export type RequestedMediaType = "audio" | "video";
export type CheckedMediaType = "audio" | "video" | "unknown";

/**
 * `setPermissionRequestHandler` receives every requested media type
 * (`getUserMedia({ audio: true })` resolves to `["audio"]`). Grant the request
 * only when it asks for the microphone and does not also ask for the camera.
 */
export function isMicrophoneOnlyRequest(
  mediaTypes: readonly RequestedMediaType[] | undefined
): boolean {
  return (
    Array.isArray(mediaTypes) &&
    mediaTypes.includes("audio") &&
    !mediaTypes.includes("video")
  );
}

/**
 * `setPermissionCheckHandler` reports a single media type (or `"unknown"`).
 * Only the microphone (audio) check is granted; camera and unknown checks are
 * denied.
 */
export function isMicrophoneCheck(
  mediaType: CheckedMediaType | undefined
): boolean {
  return mediaType === "audio";
}
