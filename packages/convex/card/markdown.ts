import {
  MarkdownContentError,
  validateMarkdownContent,
} from "@teak/files-core";
import { ConvexError } from "convex/values";

export function validateTextCardContent(content: string): string {
  try {
    return validateMarkdownContent(content);
  } catch (error) {
    if (error instanceof MarkdownContentError) {
      throw new ConvexError({
        code: error.code,
        message: error.message,
      });
    }
    throw error;
  }
}
