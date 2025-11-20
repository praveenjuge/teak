// Storage utility functions for working with Convex storage IDs
import { Id } from "../../convex/_generated/dataModel";

export const STORAGE_PREFIX = "storage:";

/**
 * Extract a Convex storage ID from an image string.
 * @param image - Image string that may contain a storage ID with "storage:" prefix
 * @returns The storage ID if found, null otherwise
 */
export const extractStorageId = (
  image?: string | null
): Id<"_storage"> | null => {
  if (!image || !image.startsWith(STORAGE_PREFIX)) return null;
  return image.slice(STORAGE_PREFIX.length) as Id<"_storage">;
};
