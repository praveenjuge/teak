import { type Color, extractColorsFromContent } from "./colorUtils";
import { extractAndValidateUrl, extractQuoteContent } from "./validationUtils";

type DetectedCardType = {
  type: "text" | "link" | "palette" | "quote";
  processedContent: string;
  url?: string;
  colors?: Color[];
  confidence: number;
};

// Main type detection function
export function detectCardTypeFromContent(content: string): DetectedCardType {
  if (!content || !content.trim()) {
    return { type: "text", processedContent: content, confidence: 0.2 };
  }

  // First check for quotes
  const quoteAnalysis = extractQuoteContent(content);
  if (quoteAnalysis.isQuote) {
    return {
      type: "quote",
      processedContent: quoteAnalysis.extractedQuote!,
      confidence: 0.95,
    };
  }

  // Then check for colors
  const colors = extractColorsFromContent(content);
  if (colors.length > 0) {
    return {
      type: "palette",
      processedContent: content.trim(),
      colors: colors,
      confidence: 0.9,
    };
  }

  // Then check for URLs
  const urlAnalysis = extractAndValidateUrl(content);
  if (urlAnalysis.isUrlOnly) {
    return {
      type: "link",
      processedContent: urlAnalysis.cleanContent,
      url: urlAnalysis.extractedUrl,
      confidence: 0.9,
    };
  }

  // Text with URL
  if (urlAnalysis.extractedUrl) {
    return {
      type: "text",
      processedContent: urlAnalysis.cleanContent,
      url: urlAnalysis.extractedUrl,
      confidence: 0.6,
    };
  }

  // Default to text
  return {
    type: "text",
    processedContent: content.trim(),
    confidence: 0.4,
  };
}
