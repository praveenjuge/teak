// Validate and extract URL from content
function extractAndValidateUrl(content: string): { isUrlOnly: boolean; extractedUrl?: string; cleanContent: string } {
  const trimmedContent = content.trim();

  // Check if content is ONLY a URL
  const urlOnlyPattern = /^https?:\/\/[^\s]+$/;
  if (urlOnlyPattern.test(trimmedContent)) {
    try {
      new URL(trimmedContent); // Validate URL
      return {
        isUrlOnly: true,
        extractedUrl: trimmedContent,
        cleanContent: trimmedContent
      };
    } catch {
      // Invalid URL, treat as text
      return { isUrlOnly: false, cleanContent: trimmedContent };
    }
  }

  // Extract URL from within text content
  const urlMatch = trimmedContent.match(/(https?:\/\/[^\s]+)/);
  if (urlMatch) {
    try {
      new URL(urlMatch[1]); // Validate URL
      return {
        isUrlOnly: false,
        extractedUrl: urlMatch[1],
        cleanContent: trimmedContent
      };
    } catch {
      // Invalid URL, ignore extraction
      return { isUrlOnly: false, cleanContent: trimmedContent };
    }
  }

  return { isUrlOnly: false, cleanContent: trimmedContent };
}

// Extract and validate quote content
function extractQuoteContent(content: string): { isQuote: boolean; extractedQuote?: string } {
  const trimmedContent = content.trim();
  
  // First priority: Check for explicit quotes wrapping the entire content
  // Match all common quotation mark Unicode characters with proper pairs:
  // " " (U+0022) - ASCII double quote
  // ' ' (U+0027) - ASCII single quote  
  // " " (U+201C, U+201D) - left/right double quotation marks
  // ' ' (U+2018, U+2019) - left/right single quotation marks
  // « » (U+00AB, U+00BB) - left/right double angle quotation marks
  // ‹ › (U+2039, U+203A) - left/right single angle quotation marks
  // „ " (U+201E, U+201D) - German-style double low-9 quotation mark
  // ‚ ' (U+201A, U+2019) - German-style single low-9 quotation mark
  
  // Use a more comprehensive approach - match any opening quote, capture content, then any closing quote
  // This covers ALL possible quotation mark Unicode characters
  const comprehensiveQuoteMatch = trimmedContent.match(/^([\u0022\u0027\u00AB\u00BB\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u201F\u2039\u203A\u2E42\u301D\u301E\u301F\uFF02\uFF07\uFF62\uFF63])([\s\S]+)([\u0022\u0027\u00AB\u00BB\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u201F\u2039\u203A\u2E42\u301D\u301E\u301F\uFF02\uFF07\uFF62\uFF63])$/);
  
  if (comprehensiveQuoteMatch && comprehensiveQuoteMatch[2].trim()) {
    return {
      isQuote: true,
      extractedQuote: comprehensiveQuoteMatch[2].trim()
    };
  }
  
  // Fallback: Also check for any content that starts and ends with the SAME quotation character
  const sameQuoteMatch = trimmedContent.match(/^([\u0022\u0027\u201C\u201D\u2018\u2019])([\s\S]+)\1$/);
  if (sameQuoteMatch && sameQuoteMatch[2].trim()) {
    return {
      isQuote: true,
      extractedQuote: sameQuoteMatch[2].trim()
    };
  }
  
  // Second priority: Check if content appears to be a quote based on patterns
  const isLikelyQuote = 
    // Contains quoted dialogue within the text
    /["'][^"']*["']/.test(trimmedContent) ||
    // Starts with common quote patterns
    /^(I\s|You\s|We\s|They\s|Life\s|Love\s|The\s.*\s(is|are|was|were))/i.test(trimmedContent) ||
    // Contains philosophical or inspirational language patterns
    /(believe|dream|hope|inspire|motivate|wisdom|truth|success|failure|journey|destiny|purpose)/i.test(trimmedContent) ||
    // Has multiple sentences with reflective tone (common in quotes)
    (trimmedContent.split(/[.!?]+/).length >= 2 && 
     /\b(I|you|we|they|life|love|time|world|people|never|always|sometimes|often)\b/i.test(trimmedContent));
  
  // Only classify as quote if it's substantial enough and likely a quote
  if (isLikelyQuote && trimmedContent.length >= 20 && trimmedContent.split(/\s+/).length >= 5) {
    return {
      isQuote: true,
      extractedQuote: trimmedContent  // Keep as-is for pattern-detected quotes
    };
  }
  
  return { isQuote: false };
}

export {
  extractAndValidateUrl,
  extractQuoteContent
};