import { expect, test } from "bun:test";
import { parseHTML } from "linkedom";

import { __testExports } from "./linkMetadata";

const {
  normalizeUrl,
  sanitizeUrl,
  sanitizeImageUrl,
  parseLinkPreview,
  pickFallbackImage,
  isBlockedAddress,
} = __testExports;

test("normalizeUrl ensures scheme", () => {
  expect(normalizeUrl("example.com")).toBe("https://example.com");
  expect(normalizeUrl("http://example.com")).toBe("http://example.com");
});

test("sanitizeUrl filters unsafe schemes", () => {
  const base = "https://example.com/path";
  expect(sanitizeUrl(base, "mailto:test@example.com")).toBeUndefined();
  expect(sanitizeUrl(base, "javascript:alert(1)")).toBeUndefined();
  expect(sanitizeUrl(base, "//cdn.example.com/image.png")).toBe("https://cdn.example.com/image.png");
});

test("sanitizeImageUrl resolves relative paths and keeps data urls", () => {
  const base = "https://example.com/article";
  expect(sanitizeImageUrl(base, "/image.jpg")).toBe("https://example.com/image.jpg");
  const dataUrl = "data:image/png;base64,aGVsbG8=";
  expect(sanitizeImageUrl(base, dataUrl)).toBe(dataUrl);
});

test("isBlockedAddress identifies private networks", () => {
  expect(isBlockedAddress("10.0.0.1")).toBe(true);
  expect(isBlockedAddress("192.168.1.10")).toBe(true);
  expect(isBlockedAddress("8.8.8.8")).toBe(false);
});

test("parseLinkPreview extracts Open Graph metadata", () => {
  const html = `
    <html>
      <head>
        <title>Example Site</title>
        <meta property="og:title" content="OG Title" />
        <meta property="og:description" content="OG Description" />
        <meta property="og:image" content="/og-image.jpg" />
        <meta property="og:url" content="https://example.com/posts/123" />
      </head>
      <body>
        <img src="/fallback.png" width="200" height="200" />
      </body>
    </html>
  `;

  const result = parseLinkPreview("https://example.com/posts/123", html);
  expect(result.title).toBe("OG Title");
  expect(result.description).toBe("OG Description");
  expect(result.imageUrl).toBe("https://example.com/og-image.jpg");
  expect(result.finalUrl).toBe("https://example.com/posts/123");
});

test("parseLinkPreview falls back to document title and images", () => {
  const html = `
    <html>
      <head>
        <title>Fallback Title</title>
      </head>
      <body>
        <img src="/small.png" width="10" height="10" />
        <img src="/large.png" width="400" height="300" />
      </body>
    </html>
  `;

  const result = parseLinkPreview("https://example.com/page", html);
  expect(result.title).toBe("Fallback Title");
  expect(result.imageUrl).toBe("https://example.com/large.png");
});

test("pickFallbackImage selects the largest candidate", () => {
  const html = `
    <html>
      <body>
        <img src="/tiny.png" width="10" height="10" />
        <img src="/medium.png" width="50" height="40" />
        <img src="/large.png" width="300" height="250" />
      </body>
    </html>
  `;

  const { document } = parseHTML(html);
  const result = pickFallbackImage(document, "https://example.com/path");
  expect(result).toBe("https://example.com/large.png");
});
