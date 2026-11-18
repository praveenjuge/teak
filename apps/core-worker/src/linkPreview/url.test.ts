import { describe, expect, it } from "bun:test";
import { normalizeUrl } from "./url";

describe("normalizeUrl", () => {
  describe("adding https protocol", () => {
    it("should add https:// to URLs without protocol", () => {
      expect(normalizeUrl("example.com")).toBe("https://example.com");
      expect(normalizeUrl("www.example.com")).toBe("https://www.example.com");
    });

    it("should add https:// to URLs with port but no protocol", () => {
      expect(normalizeUrl("localhost:3000")).toBe("https://localhost:3000");
      expect(normalizeUrl("example.com:8080/path")).toBe(
        "https://example.com:8080/path"
      );
    });
  });

  describe("preserving existing protocols", () => {
    it("should preserve https:// protocol", () => {
      expect(normalizeUrl("https://example.com")).toBe("https://example.com");
      expect(normalizeUrl("https://example.com/path")).toBe(
        "https://example.com/path"
      );
    });

    it("should preserve http:// protocol", () => {
      expect(normalizeUrl("http://example.com")).toBe("http://example.com");
      expect(normalizeUrl("http://example.com/path")).toBe(
        "http://example.com/path"
      );
    });
  });

  describe("URL components preservation", () => {
    it("should preserve all components together", () => {
      expect(normalizeUrl("example.com/path?key=value#section")).toBe(
        "https://example.com/path?key=value#section"
      );
    });

    it("should preserve authentication credentials", () => {
      expect(normalizeUrl("https://user:pass@example.com")).toBe(
        "https://user:pass@example.com"
      );
    });
  });
});
