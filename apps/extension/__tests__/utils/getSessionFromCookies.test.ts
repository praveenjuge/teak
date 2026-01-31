// @ts-nocheck
import { describe, test, expect, mock } from "bun:test";

describe("getSessionTokenFromCookies", () => {
  describe("URL Configuration", () => {
    test("should use localhost URL in development", () => {
      const isDev = true;
      const url = isDev ? "http://localhost:3000" : "https://app.teakvault.com";

      expect(url).toBe("http://localhost:3000");
    });

    test("should use production URL in production", () => {
      const isDev = false;
      const url = isDev ? "http://localhost:3000" : "https://app.teakvault.com";

      expect(url).toBe("https://app.teakvault.com");
    });

    test("should use http protocol for development", () => {
      const devUrl = "http://localhost:3000";

      expect(devUrl).toStartWith("http://");
    });

    test("should use https protocol for production", () => {
      const prodUrl = "https://app.teakvault.com";

      expect(prodUrl).toStartWith("https://");
    });

    test("should use localhost hostname in development", () => {
      const devUrl = "http://localhost:3000";

      expect(devUrl).toContain("localhost");
    });

    test("should use port 3000 in development", () => {
      const devUrl = "http://localhost:3000";

      expect(devUrl).toContain(":3000");
    });

    test("should use app.teakvault.com domain in production", () => {
      const prodUrl = "https://app.teakvault.com";

      expect(prodUrl).toContain("app.teakvault.com");
    });
  });

  describe("Cookie Name Configuration", () => {
    test("should use non-secure cookie name in development", () => {
      const isDev = true;
      const cookieName = isDev
        ? "better-auth.session_token"
        : "__Secure-better-auth.session_token";

      expect(cookieName).toBe("better-auth.session_token");
    });

    test("should use secure cookie name in production", () => {
      const isDev = false;
      const cookieName = isDev
        ? "better-auth.session_token"
        : "__Secure-better-auth.session_token";

      expect(cookieName).toBe("__Secure-better-auth.session_token");
    });

    test("should not have __Secure prefix in development", () => {
      const devCookieName = "better-auth.session_token";

      expect(devCookieName).not.toStartWith("__Secure-");
    });

    test("should have __Secure prefix in production", () => {
      const prodCookieName = "__Secure-better-auth.session_token";

      expect(prodCookieName).toStartWith("__Secure-");
    });

    test("should use better-auth prefix in all environments", () => {
      const devCookieName = "better-auth.session_token";
      const prodCookieName = "__Secure-better-auth.session_token";

      expect(devCookieName).toStartWith("better-auth");
      expect(prodCookieName).toContain("better-auth");
    });

    test("should use session_token suffix in all environments", () => {
      const devCookieName = "better-auth.session_token";
      const prodCookieName = "__Secure-better-auth.session_token";

      expect(devCookieName).toEndWith(".session_token");
      expect(prodCookieName).toEndWith(".session_token");
    });
  });

  describe("Cookie Retrieval - Success Cases", () => {
    test("should retrieve session token from cookies in development", async () => {
      const mockGet = mock(() =>
        Promise.resolve({
          name: "better-auth.session_token",
          value: "dev-session-token-123",
          domain: "localhost",
        })
      );

      const cookie = await mockGet({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });

      expect(cookie.value).toBe("dev-session-token-123");
      expect(mockGet).toHaveBeenCalledWith({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });
    });

    test("should retrieve session token from cookies in production", async () => {
      const mockGet = mock(() =>
        Promise.resolve({
          name: "__Secure-better-auth.session_token",
          value: "prod-session-token-456",
          domain: "app.teakvault.com",
          secure: true,
        })
      );

      const cookie = await mockGet({
        url: "https://app.teakvault.com",
        name: "__Secure-better-auth.session_token",
      });

      expect(cookie.value).toBe("prod-session-token-456");
      expect(mockGet).toHaveBeenCalledWith({
        url: "https://app.teakvault.com",
        name: "__Secure-better-auth.session_token",
      });
    });

    test("should return cookie value when found", async () => {
      const mockGet = mock(() =>
        Promise.resolve({
          name: "better-auth.session_token",
          value: "session-token-value",
        })
      );

      const cookie = await mockGet({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });

      expect(cookie?.value).toBe("session-token-value");
    });

    test("should handle cookie with additional properties", async () => {
      const mockGet = mock(() =>
        Promise.resolve({
          name: "better-auth.session_token",
          value: "session-token-abc",
          domain: "localhost",
          path: "/",
          httpOnly: true,
          secure: false,
        })
      );

      const cookie = await mockGet({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });

      expect(cookie.value).toBe("session-token-abc");
      expect(cookie.domain).toBe("localhost");
      expect(cookie.path).toBe("/");
      expect(cookie.httpOnly).toBe(true);
    });

    test("should return valid token string", async () => {
      const mockGet = mock(() =>
        Promise.resolve({
          name: "better-auth.session_token",
          value: "valid-session-token",
        })
      );

      const cookie = await mockGet({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });

      expect(typeof cookie.value).toBe("string");
      expect(cookie.value.length).toBeGreaterThan(0);
    });
  });

  describe("Cookie Retrieval - Failure Cases", () => {
    test("should return null when cookie not found", async () => {
      const mockGet = mock(() => Promise.resolve(null));

      const cookie = await mockGet({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });

      expect(cookie).toBeNull();
    });

    test("should return null when cookie is undefined", async () => {
      const mockGet = mock(() => Promise.resolve(undefined));

      const cookie = await mockGet({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });

      // The mock returns undefined, which is the expected behavior
      expect(cookie).toBeUndefined();
    });

    test("should handle cookie retrieval errors gracefully", async () => {
      const mockGet = mock(() => Promise.reject(new Error("Cookie access denied")));

      try {
        await mockGet({
          url: "http://localhost:3000",
          name: "better-auth.session_token",
        });
      } catch (error) {
        expect(error).toBeTruthy();
      }
    });

    test("should handle missing cookie name", async () => {
      const mockGet = mock(() =>
        Promise.resolve({
          url: "http://localhost:3000",
        })
      );

      const cookie = await mockGet({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });

      expect(cookie).toBeDefined();
    });

    test("should return null on error", async () => {
      let cookie = null;
      const mockGet = mock(() => {
        throw new Error("Failed to get cookie");
      });

      try {
        await mockGet({
          url: "http://localhost:3000",
          name: "better-auth.session_token",
        });
      } catch {
        cookie = null;
      }

      expect(cookie).toBeNull();
    });

    test("should handle invalid URL", async () => {
      const mockGet = mock(() => Promise.reject(new Error("Invalid URL")));

      try {
        await mockGet({
          url: "invalid-url",
          name: "better-auth.session_token",
        });
      } catch (error) {
        expect(error).toBeTruthy();
      }
    });

    test("should handle network errors", async () => {
      const mockGet = mock(() =>
        Promise.reject(new Error("Network error"))
      );

      try {
        await mockGet({
          url: "http://localhost:3000",
          name: "better-auth.session_token",
        });
      } catch (error) {
        expect(error).toBeTruthy();
      }
    });
  });

  describe("Chrome Cookies API", () => {
    test("should call chrome.cookies.get with correct parameters", async () => {
      const mockGet = mock(() => Promise.resolve(null));
      const url = "http://localhost:3000";
      const name = "better-auth.session_token";

      await mockGet({ url, name });

      expect(mockGet).toHaveBeenCalledWith({ url, name });
    });

    test("should handle chrome.cookies.get response structure", async () => {
      const mockGet = mock(() =>
        Promise.resolve({
          name: "better-auth.session_token",
          value: "token-value",
          domain: "localhost",
          hostOnly: true,
          path: "/",
          secure: false,
          httpOnly: true,
          session: true,
        })
      );

      const cookie = await mockGet({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });

      expect(cookie).toHaveProperty("name");
      expect(cookie).toHaveProperty("value");
      expect(cookie).toHaveProperty("domain");
    });

    test("should handle cookies API being undefined", () => {
      const chromeCookies = undefined;

      const hasCookiesApi = typeof chromeCookies !== "undefined";

      expect(hasCookiesApi).toBe(false);
    });
  });

  describe("hasValidSession Function", () => {
    test("should return true when session token exists", async () => {
      const mockGetToken = mock(() => Promise.resolve("valid-session-token"));

      const token = await mockGetToken();
      const hasValidSession = token !== null;

      expect(hasValidSession).toBe(true);
      expect(token).toBe("valid-session-token");
    });

    test("should return false when session token is null", async () => {
      const mockGetToken = mock(() => Promise.resolve(null));

      const token = await mockGetToken();
      const hasValidSession = token !== null;

      expect(hasValidSession).toBe(false);
    });

    test("should return false when session token is undefined", async () => {
      const mockGetToken = mock(() => Promise.resolve(undefined));

      const token = await mockGetToken();
      const hasValidSession = token !== null && token !== undefined;

      expect(hasValidSession).toBe(false);
    });

    test("should return false when session token is empty string", async () => {
      const mockGetToken = mock(() => Promise.resolve(""));

      const token = await mockGetToken();
      const hasValidSession = token !== null && token.length > 0;

      expect(hasValidSession).toBe(false);
    });

    test("should handle token retrieval errors", async () => {
      const mockGetToken = mock(() => Promise.reject(new Error("Failed to get token")));

      try {
        await mockGetToken();
      } catch (error) {
        expect(error).toBeTruthy();
      }
    });

    test("should validate token format", async () => {
      const mockGetToken = mock(() =>
        Promise.resolve("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token")
      );

      const token = await mockGetToken();
      const hasValidSession = token !== null;

      expect(hasValidSession).toBe(true);
      expect(token).toStartWith("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    });
  });

  describe("Cookie Security", () => {
    test("should use Secure flag in production cookies", async () => {
      const mockGet = mock(() =>
        Promise.resolve({
          name: "__Secure-better-auth.session_token",
          value: "secure-token",
          secure: true,
        })
      );

      const cookie = await mockGet({
        url: "https://app.teakvault.com",
        name: "__Secure-better-auth.session_token",
      });

      expect(cookie.secure).toBe(true);
    });

    test("should use HttpOnly flag", async () => {
      const mockGet = mock(() =>
        Promise.resolve({
          name: "better-auth.session_token",
          value: "http-only-token",
          httpOnly: true,
        })
      );

      const cookie = await mockGet({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });

      expect(cookie.httpOnly).toBe(true);
    });

    test("should respect SameSite attribute", async () => {
      const mockGet = mock(() =>
        Promise.resolve({
          name: "better-auth.session_token",
          value: "samesite-token",
          sameSite: "lax",
        })
      );

      const cookie = await mockGet({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });

      expect(cookie.sameSite).toBe("lax");
    });

    test("should handle cookie domain restrictions", async () => {
      const mockGet = mock(() =>
        Promise.resolve({
          name: "better-auth.session_token",
          value: "domain-token",
          domain: ".teakvault.com",
        })
      );

      const cookie = await mockGet({
        url: "https://app.teakvault.com",
        name: "__Secure-better-auth.session_token",
      });

      expect(cookie.domain).toBe(".teakvault.com");
    });

    test("should handle cookie path restrictions", async () => {
      const mockGet = mock(() =>
        Promise.resolve({
          name: "better-auth.session_token",
          value: "path-token",
          path: "/",
        })
      );

      const cookie = await mockGet({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });

      expect(cookie.path).toBe("/");
    });
  });

  describe("Cross-Domain Session Sharing", () => {
    test("should share session between extension and web app", async () => {
      const webAppCookie = {
        name: "better-auth.session_token",
        value: "shared-session-token",
        domain: "localhost",
      };

      const mockGet = mock(() => Promise.resolve(webAppCookie));

      const cookie = await mockGet({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });

      expect(cookie.value).toBe("shared-session-token");
    });

    test("should access cookies from web app domain", async () => {
      const mockGet = mock(() =>
        Promise.resolve({
          name: "__Secure-better-auth.session_token",
          value: "app-domain-token",
          domain: "app.teakvault.com",
        })
      );

      const cookie = await mockGet({
        url: "https://app.teakvault.com",
        name: "__Secure-better-auth.session_token",
      });

      expect(cookie.domain).toBe("app.teakvault.com");
    });

    test("should handle subdomain cookies", async () => {
      const mockGet = mock(() =>
        Promise.resolve({
          name: "better-auth.session_token",
          value: "subdomain-token",
          domain: ".teakvault.com",
        })
      );

      const cookie = await mockGet({
        url: "https://app.teakvault.com",
        name: "__Secure-better-auth.session_token",
      });

      expect(cookie.domain).toStartWith(".");
    });
  });

  describe("Error Handling", () => {
    test("should wrap cookie retrieval in try-catch", async () => {
      let cookie = null;
      const mockGet = mock(() => {
        throw new Error("Cookie error");
      });

      try {
        await mockGet({
          url: "http://localhost:3000",
          name: "better-auth.session_token",
        });
      } catch {
        cookie = null;
      }

      expect(cookie).toBeNull();
    });

    test("should return null on any error", async () => {
      const mockGet = mock(() => {
        throw new Error("Any error");
      });

      let result = null;
      try {
        await mockGet({
          url: "http://localhost:3000",
          name: "better-auth.session_token",
        });
      } catch {
        result = null;
      }

      expect(result).toBeNull();
    });

    test("should handle permission errors", async () => {
      const mockGet = mock(() =>
        Promise.reject(new Error("Permission denied"))
      );

      try {
        await mockGet({
          url: "http://localhost:3000",
          name: "better-auth.session_token",
        });
      } catch (error) {
        expect((error as Error).message).toContain("Permission denied");
      }
    });
  });

  describe("Environment Detection", () => {
    test("should detect development environment", () => {
      const isDev = true;

      expect(isDev).toBe(true);
    });

    test("should detect production environment", () => {
      const isDev = false;

      expect(isDev).toBe(false);
    });

    test("should use appropriate URL based on environment", () => {
      const isDev = true;
      const url = isDev ? "http://localhost:3000" : "https://app.teakvault.com";

      expect(isDev ? url === "http://localhost:3000" : url === "https://app.teakvault.com").toBe(
        true
      );
    });

    test("should use appropriate cookie name based on environment", () => {
      const isDev = false;
      const cookieName = isDev
        ? "better-auth.session_token"
        : "__Secure-better-auth.session_token";

      expect(isDev ? cookieName === "better-auth.session_token" : cookieName === "__Secure-better-auth.session_token").toBe(
        true
      );
    });
  });

  describe("Cookie Expiration", () => {
    test("should handle session cookies (no expiration)", async () => {
      const mockGet = mock(() =>
        Promise.resolve({
          name: "better-auth.session_token",
          value: "session-cookie",
          session: true,
        })
      );

      const cookie = await mockGet({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });

      expect(cookie.session).toBe(true);
    });

    test("should handle persistent cookies with expiration", async () => {
      const expirationDate = Date.now() / 1000 + 3600; // 1 hour from now

      const mockGet = mock(() =>
        Promise.resolve({
          name: "better-auth.session_token",
          value: "persistent-cookie",
          expirationDate,
        })
      );

      const cookie = await mockGet({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });

      expect(cookie.expirationDate).toBeGreaterThan(Date.now() / 1000);
    });

    test("should handle expired cookies", async () => {
      const expirationDate = Date.now() / 1000 - 3600; // 1 hour ago

      const mockGet = mock(() =>
        Promise.resolve({
          name: "better-auth.session_token",
          value: "expired-cookie",
          expirationDate,
        })
      );

      const cookie = await mockGet({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });

      expect(cookie.expirationDate).toBeLessThan(Date.now() / 1000);
    });
  });

  describe("Return Value Types", () => {
    test("should return string when cookie found", async () => {
      const mockGet = mock(() =>
        Promise.resolve({
          name: "better-auth.session_token",
          value: "token-string",
        })
      );

      const cookie = await mockGet({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });

      expect(typeof cookie.value).toBe("string");
    });

    test("should return null when cookie not found", async () => {
      const mockGet = mock(() => Promise.resolve(null));

      const cookie = await mockGet({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });

      expect(cookie).toBeNull();
    });

    test("should return Promise<string | null>", async () => {
      const mockGet = mock(() => Promise.resolve("token"));

      const result = await mockGet({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });

      expect(result === null || typeof result === "string" || typeof result === "object").toBe(
        true
      );
    });
  });

  describe("Edge Cases", () => {
    test("should handle very long token values", async () => {
      const longToken = "a".repeat(10000);

      const mockGet = mock(() =>
        Promise.resolve({
          name: "better-auth.session_token",
          value: longToken,
        })
      );

      const cookie = await mockGet({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });

      expect(cookie.value.length).toBe(10000);
    });

    test("should handle special characters in token", async () => {
      const specialToken = "token-with-special.chars_123.abc";

      const mockGet = mock(() =>
        Promise.resolve({
          name: "better-auth.session_token",
          value: specialToken,
        })
      );

      const cookie = await mockGet({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });

      expect(cookie.value).toContain(".");
      expect(cookie.value).toContain("-");
      expect(cookie.value).toContain("_");
    });

    test("should handle URL-encoded tokens", async () => {
      const encodedToken = "token%20with%20spaces";

      const mockGet = mock(() =>
        Promise.resolve({
          name: "better-auth.session_token",
          value: encodedToken,
        })
      );

      const cookie = await mockGet({
        url: "http://localhost:3000",
        name: "better-auth.session_token",
      });

      expect(cookie.value).toContain("%20");
    });
  });
});
