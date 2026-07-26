import { ConvexError } from "convex/values";
import {
  MarkdownContentError,
  validateMarkdownContent,
} from "../shared/markdown";

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
