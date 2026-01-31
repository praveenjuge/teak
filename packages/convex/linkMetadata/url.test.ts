import { describe, expect, it } from "bun:test";
import { normalizeUrl } from "./url";

describe("normalizeUrl", () => {
  describe("adding https protocol", () => {
    it("should add https:// to URLs without protocol", () => {
      expect(normalizeUrl("example.com")).toBe("https://example.com");
      expect(normalizeUrl("www.example.com")).toBe("https://www.example.com");
    });

    it("should add https:// to URLs with path but no protocol", () => {
      expect(normalizeUrl("example.com/path")).toBe("https://example.com/path");
      expect(normalizeUrl("example.com/path/to/page")).toBe(
        "https://example.com/path/to/page"
      );
    });

    it("should add https:// to URLs with query string but no protocol", () => {
      expect(normalizeUrl("example.com?query=value")).toBe(
        "https://example.com?query=value"
      );
    });

    it("should add https:// to URLs with fragment but no protocol", () => {
      expect(normalizeUrl("example.com#section")).toBe(
        "https://example.com#section"
      );
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

    it("should not change case of existing protocol", () => {
      // normalizeUrl checks for exact "http://" or "https://" prefix
      expect(normalizeUrl("HTTP://example.com")).toBe(
        "https://HTTP://example.com"
      );
      expect(normalizeUrl("HtTp://example.com")).toBe(
        "https://HtTp://example.com"
      );
    });
  });

  describe("URL components preservation", () => {
    it("should preserve path", () => {
      expect(normalizeUrl("example.com/path/to/resource")).toBe(
        "https://example.com/path/to/resource"
      );
    });

    it("should preserve query parameters", () => {
      expect(normalizeUrl("example.com?key=value&foo=bar")).toBe(
        "https://example.com?key=value&foo=bar"
      );
    });

    it("should preserve fragment", () => {
      expect(normalizeUrl("example.com#section")).toBe(
        "https://example.com#section"
      );
    });

    it("should preserve all components together", () => {
      expect(normalizeUrl("example.com/path?key=value#section")).toBe(
        "https://example.com/path?key=value#section"
      );
    });

    it("should preserve port number", () => {
      expect(normalizeUrl("localhost:3000/path")).toBe(
        "https://localhost:3000/path"
      );
    });

    it("should preserve authentication credentials", () => {
      expect(normalizeUrl("https://user:pass@example.com")).toBe(
        "https://user:pass@example.com"
      );
    });

    it("should preserve IP addresses", () => {
      expect(normalizeUrl("192.168.1.1/path")).toBe("https://192.168.1.1/path");
    });
  });

  describe("edge cases", () => {
    it("should handle empty string", () => {
      expect(normalizeUrl("")).toBe("https://");
    });

    it("should handle just protocol", () => {
      expect(normalizeUrl("https://")).toBe("https://");
      expect(normalizeUrl("http://")).toBe("http://");
    });

    it("should handle leading/trailing whitespace", () => {
      // normalizeUrl doesn't trim, it just prepends https:// if needed
      expect(normalizeUrl("  example.com  ")).toBe("https://  example.com  ");
    });

    it("should handle subdomains", () => {
      expect(normalizeUrl("blog.example.com")).toBe("https://blog.example.com");
      expect(normalizeUrl("api.v3.example.com")).toBe(
        "https://api.v3.example.com"
      );
    });

    it("should handle complex domain names", () => {
      expect(normalizeUrl("example.co.uk")).toBe("https://example.co.uk");
      expect(normalizeUrl("sub.domain.example.com")).toBe(
        "https://sub.domain.example.com"
      );
    });

    it("should handle international domain names", () => {
      expect(normalizeUrl("müller.de")).toBe("https://müller.de");
      expect(normalizeUrl("例え.jp")).toBe("https://例え.jp");
    });
  });

  describe("security considerations", () => {
    it("should not prevent javascript: URLs (caller must validate)", () => {
      expect(normalizeUrl("javascript:alert(1)")).toBe(
        "https://javascript:alert(1)"
      );
    });

    it("should not prevent data: URLs", () => {
      expect(normalizeUrl("data:text/html,<script>")).toBe(
        "https://data:text/html,<script>"
      );
    });

    it("should not prevent mailto: URLs", () => {
      expect(normalizeUrl("mailto:test@example.com")).toBe(
        "https://mailto:test@example.com"
      );
    });

    it("should not prevent file: URLs", () => {
      expect(normalizeUrl("file:///etc/passwd")).toBe(
        "https://file:///etc/passwd"
      );
    });
  });

  describe("real-world examples", () => {
    it("should handle GitHub URLs", () => {
      expect(normalizeUrl("github.com/user/repo")).toBe(
        "https://github.com/user/repo"
      );
    });

    it("should handle YouTube URLs", () => {
      expect(normalizeUrl("youtube.com/watch?v=123")).toBe(
        "https://youtube.com/watch?v=123"
      );
    });

    it("should handle youtu.be short URLs", () => {
      expect(normalizeUrl("youtu.be/123")).toBe("https://youtu.be/123");
    });

    it("should handle Twitter URLs", () => {
      expect(normalizeUrl("twitter.com/user/status/123")).toBe(
        "https://twitter.com/user/status/123"
      );
    });

    it("should handle Amazon URLs", () => {
      expect(normalizeUrl("amazon.com/dp/B123456789")).toBe(
        "https://amazon.com/dp/B123456789"
      );
    });

    it("should handle news site URLs", () => {
      expect(normalizeUrl("nytimes.com/2024/01/01/world/article.html")).toBe(
        "https://nytimes.com/2024/01/01/world/article.html"
      );
    });

    it("should handle localhost development URLs", () => {
      expect(normalizeUrl("localhost:3000/api/users")).toBe(
        "https://localhost:3000/api/users"
      );
    });

    it("should handle local network URLs", () => {
      expect(normalizeUrl("192.168.1.100:8080/admin")).toBe(
        "https://192.168.1.100:8080/admin"
      );
    });
  });
});
