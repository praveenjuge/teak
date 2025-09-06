import { type Color, extractColorsFromContent } from './colorUtils';
import { extractAndValidateUrl, extractQuoteContent } from './validationUtils';

// Main type detection function
export function detectCardTypeFromContent(content: string): {
  type: "text" | "link" | "palette" | "quote";
  processedContent: string;
  url?: string;
  colors?: Color[];
} {
  if (!content || !content.trim()) {
    return { type: "text", processedContent: content };
  }

  // First check for quotes
  const quoteAnalysis = extractQuoteContent(content);
  if (quoteAnalysis.isQuote) {
    return {
      type: "quote",
      processedContent: quoteAnalysis.extractedQuote!
    };
  }

  // Then check for colors
  const colors = extractColorsFromContent(content);
  if (colors.length > 0) {
    return {
      type: "palette",
      processedContent: content.trim(),
      colors: colors
    };
  }

  // Then check for URLs
  const urlAnalysis = extractAndValidateUrl(content);
  if (urlAnalysis.isUrlOnly) {
    return {
      type: "link",
      processedContent: urlAnalysis.cleanContent,
      url: urlAnalysis.extractedUrl
    };
  }

  // Text with URL
  if (urlAnalysis.extractedUrl) {
    return {
      type: "text",
      processedContent: urlAnalysis.cleanContent,
      url: urlAnalysis.extractedUrl
    };
  }

  // Default to text
  return {
    type: "text",
    processedContent: content.trim()
  };
}