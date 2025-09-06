// Helper function to detect file type from MIME type
export const getFileCardType = (mimeType: string): "image" | "video" | "audio" | "document" => {
  const normalizedType = mimeType.toLowerCase();

  if (normalizedType.startsWith("image/")) return "image";
  if (normalizedType.startsWith("video/")) return "video";
  if (normalizedType.startsWith("audio/")) return "audio";

  return "document";
};