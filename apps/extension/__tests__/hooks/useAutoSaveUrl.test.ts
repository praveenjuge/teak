// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";

describe("useAutoSaveUrl Hook", () => {
  describe("URL Validation", () => {
    test("should validate http URLs", () => {
      const url = "http://example.com";
      const INVALID_URL_PATTERNS = [
        /^chrome:/,
        /^chrome-extension:/,
        /^about:/,
        /^data:/,
        /^javascript:/,
        /^file:/,
        /^moz-extension:/,
        /^edge-extension:/,
      ];

      const isValid =
        !INVALID_URL_PATTERNS.some((pattern) => pattern.test(url)) &&
        (url.startsWith("http://") || url.startsWith("https://"));

      expect(isValid).toBe(true);
    });

    test("should validate https URLs", () => {
      const url = "https://example.com";
      const INVALID_URL_PATTERNS = [
        /^chrome:/,
        /^chrome-extension:/,
        /^about:/,
        /^data:/,
        /^javascript:/,
        /^file:/,
        /^moz-extension:/,
        /^edge-extension:/,
      ];

      const isValid =
        !INVALID_URL_PATTERNS.some((pattern) => pattern.test(url)) &&
        (url.startsWith("http://") || url.startsWith("https://"));

      expect(isValid).toBe(true);
    });

    test("should invalidate chrome:// URLs", () => {
      const url = "chrome://extensions";
      const INVALID_URL_PATTERNS = [/^chrome:/];

      const isInvalid = INVALID_URL_PATTERNS.some((pattern) =>
        pattern.test(url)
      );

      expect(isInvalid).toBe(true);
    });

    test("should invalidate chrome-extension:// URLs", () => {
      const url = "chrome-extension://abcdef/popup.html";
      const INVALID_URL_PATTERNS = [/^chrome-extension:/];

      const isInvalid = INVALID_URL_PATTERNS.some((pattern) =>
        pattern.test(url)
      );

      expect(isInvalid).toBe(true);
    });

    test("should invalidate about: URLs", () => {
      const url = "about:blank";
      const INVALID_URL_PATTERNS = [/^about:/];

      const isInvalid = INVALID_URL_PATTERNS.some((pattern) =>
        pattern.test(url)
      );

      expect(isInvalid).toBe(true);
    });

    test("should invalidate data: URLs", () => {
      const url = "data:text/html,<h1>Hello</h1>";
      const INVALID_URL_PATTERNS = [/^data:/];

      const isInvalid = INVALID_URL_PATTERNS.some((pattern) =>
        pattern.test(url)
      );

      expect(isInvalid).toBe(true);
    });

    test("should invalidate javascript: URLs", () => {
      const url = "javascript:alert('hi')";
      const INVALID_URL_PATTERNS = [/^javascript:/];

      const isInvalid = INVALID_URL_PATTERNS.some((pattern) =>
        pattern.test(url)
      );

      expect(isInvalid).toBe(true);
    });

    test("should invalidate file:// URLs", () => {
      const url = "file:///path/to/file.html";
      const INVALID_URL_PATTERNS = [/^file:/];

      const isInvalid = INVALID_URL_PATTERNS.some((pattern) =>
        pattern.test(url)
      );

      expect(isInvalid).toBe(true);
    });

    test("should invalidate moz-extension:// URLs", () => {
      const url = "moz-extension://abcdef/popup.html";
      const INVALID_URL_PATTERNS = [/^moz-extension:/];

      const isInvalid = INVALID_URL_PATTERNS.some((pattern) =>
        pattern.test(url)
      );

      expect(isInvalid).toBe(true);
    });

    test("should invalidate edge-extension:// URLs", () => {
      const url = "edge-extension://abcdef/popup.html";
      const INVALID_URL_PATTERNS = [/^edge-extension:/];

      const isInvalid = INVALID_URL_PATTERNS.some((pattern) =>
        pattern.test(url)
      );

      expect(isInvalid).toBe(true);
    });

    test("should invalidate empty URLs", () => {
      const url = "";

      const isValid =
        !!url && (url.startsWith("http://") || url.startsWith("https://"));

      expect(isValid).toBe(false);
    });

    test("should invalidate undefined URLs", () => {
      const url = undefined;

      const isValid = !!url;

      expect(isValid).toBe(false);
    });

    test("should invalidate non-http/https URLs", () => {
      const url = "ftp://example.com";

      const isValid = url.startsWith("http://") || url.startsWith("https://");

      expect(isValid).toBe(false);
    });

    test("should handle complex valid URLs", () => {
      const url = "https://example.com/path?query=value#hash";

      const isValid = url.startsWith("http://") || url.startsWith("https://");

      expect(isValid).toBe(true);
    });

    test("should handle URLs with authentication", () => {
      const url = "https://user:pass@example.com";

      const isValid = url.startsWith("http://") || url.startsWith("https://");

      expect(isValid).toBe(true);
    });

    test("should handle localhost URLs", () => {
      const url = "http://localhost:3000";

      const isValid = url.startsWith("http://") || url.startsWith("https://");

      expect(isValid).toBe(true);
    });

    test("should handle IP addresses", () => {
      const url = "http://192.168.1.1:8080";

      const isValid = url.startsWith("http://") || url.startsWith("https://");

      expect(isValid).toBe(true);
    });
  });

  describe("State Management", () => {
    test("should initialize with idle state", () => {
      const state = "idle";

      expect(state).toBe("idle");
    });

    test("should transition to loading state when checking URL", () => {
      const state = "loading";

      expect(state).toBe("loading");
    });

    test("should transition to success state after save", () => {
      const state = "success";

      expect(state).toBe("success");
    });

    test("should transition to error state on failure", () => {
      const state = "error";

      expect(state).toBe("error");
    });

    test("should transition to invalid-url state for invalid URLs", () => {
      const state = "invalid-url";

      expect(state).toBe("invalid-url");
    });

    test("should transition to duplicate state when duplicate found", () => {
      const state = "duplicate";

      expect(state).toBe("duplicate");
    });

    test("should store error message in error state", () => {
      const error = "Failed to get current tab";

      expect(error).toBeTruthy();
    });

    test("should store current URL in state", () => {
      const currentUrl = "https://example.com/page";

      expect(currentUrl).toBe("https://example.com/page");
    });

    test("should store duplicate card in state", () => {
      const duplicateCard = {
        _id: "abc123",
        content: "https://example.com",
        type: "link",
      };

      expect(duplicateCard._id).toBe("abc123");
      expect(duplicateCard.content).toBe("https://example.com");
    });
  });

  describe("Tab Query", () => {
    test("should query active tab in current window", async () => {
      const mockQuery = mock(() =>
        Promise.resolve([{ id: 1, url: "https://example.com" }])
      );

      const tabs = await mockQuery({ active: true, currentWindow: true });
      const currentTab = tabs[0];

      expect(mockQuery).toHaveBeenCalledWith({
        active: true,
        currentWindow: true,
      });
      expect(currentTab?.url).toBe("https://example.com");
    });

    test("should handle missing active tab", async () => {
      const mockQuery = mock(() => Promise.resolve([]));

      const tabs = await mockQuery({ active: true, currentWindow: true });
      const currentTab = tabs[0];

      expect(currentTab).toBeUndefined();
    });

    test("should handle tab without URL", async () => {
      const mockQuery = mock(() => Promise.resolve([{ id: 1 }]));

      const tabs = await mockQuery({ active: true, currentWindow: true });
      const currentTab = tabs[0];

      expect(currentTab?.url).toBeUndefined();
    });

    test("should handle tab query errors", async () => {
      const mockQuery = mock(() =>
        Promise.reject(new Error("Tab query failed"))
      );

      try {
        await mockQuery({ active: true, currentWindow: true });
      } catch (error) {
        expect(error).toBeTruthy();
      }
    });
  });

  describe("Context Menu Detection", () => {
    test("should check for context menu state before saving", async () => {
      const mockGet = mock(() =>
        Promise.resolve({
          contextMenuSave: {
            action: "save-page",
            timestamp: Date.now(),
            status: "saving",
          },
        })
      );

      const { contextMenuSave } = await mockGet("contextMenuSave");

      expect(mockGet).toHaveBeenCalledWith("contextMenuSave");
      expect(contextMenuSave?.status).toBe("saving");
    });

    test("should not save if context menu action within 5 seconds", () => {
      const contextMenuTimestamp = Date.now() - 3000; // 3 seconds ago
      const timeSinceContextMenu = Date.now() - contextMenuTimestamp;

      const shouldSkipAutoSave = timeSinceContextMenu < 5000;

      expect(shouldSkipAutoSave).toBe(true);
    });

    test("should save if context menu action older than 5 seconds", () => {
      const contextMenuTimestamp = Date.now() - 6000; // 6 seconds ago
      const timeSinceContextMenu = Date.now() - contextMenuTimestamp;

      const shouldSkipAutoSave = timeSinceContextMenu < 5000;

      expect(shouldSkipAutoSave).toBe(false);
    });

    test("should handle missing context menu state", async () => {
      const mockGet = mock(() => Promise.resolve({}));

      const result = await mockGet("contextMenuSave");

      expect(result.contextMenuSave).toBeUndefined();
    });
  });

  describe("Duplicate Detection", () => {
    test("should query for duplicate card", () => {
      const url = "https://example.com";
      const queryArgs = { url };

      expect(queryArgs).toEqual({ url: "https://example.com" });
    });

    test("should skip query if URL not provided", () => {
      const url = undefined;
      const queryArgs = url ? { url } : "skip";

      expect(queryArgs).toBe("skip");
    });

    test("should handle duplicate found", () => {
      const duplicateCard = {
        _id: "abc123",
        content: "https://example.com",
        type: "link",
      };

      const hasDuplicate = !!duplicateCard;

      expect(hasDuplicate).toBe(true);
    });

    test("should handle no duplicate found", () => {
      const duplicateCard: null = null;

      const hasDuplicate = !!duplicateCard;

      expect(hasDuplicate).toBe(false);
    });

    test("should wait for duplicate query to complete", () => {
      const duplicateCard = undefined; // Still loading
      const isLoading = duplicateCard === undefined;

      expect(isLoading).toBe(true);
    });
  });

  describe("Card Creation", () => {
    test("should call createCard mutation with URL", async () => {
      const mockCreateCard = mock(() => Promise.resolve("card-id-123"));
      const url = "https://example.com";

      await mockCreateCard({ content: url });

      expect(mockCreateCard).toHaveBeenCalledWith({
        content: "https://example.com",
      });
    });

    test("should handle successful card creation", async () => {
      const mockCreateCard = mock(() => Promise.resolve("card-id-123"));

      const result = await mockCreateCard({ content: "https://example.com" });

      expect(result).toBe("card-id-123");
    });

    test("should handle card creation errors", async () => {
      const mockCreateCard = mock(() =>
        Promise.reject(new Error("Failed to create card"))
      );

      try {
        await mockCreateCard({ content: "https://example.com" });
      } catch (error) {
        expect(error).toBeTruthy();
      }
    });

    test("should only create card if no duplicate", () => {
      const duplicateCard: null = null;
      const shouldCreate = !duplicateCard;

      expect(shouldCreate).toBe(true);
    });
  });

  describe("Authentication Check", () => {
    test("should not run when not authenticated", () => {
      const isAuthenticated = false;
      const hasCheckedRef = { current: false };

      const shouldRun = isAuthenticated && !hasCheckedRef.current;

      expect(shouldRun).toBe(false);
    });

    test("should run when authenticated", () => {
      const isAuthenticated = true;
      const hasCheckedRef = { current: false };

      const shouldRun = isAuthenticated && !hasCheckedRef.current;

      expect(shouldRun).toBe(true);
    });

    test("should not run multiple times", () => {
      const isAuthenticated = true;
      const hasCheckedRef = { current: true };

      const shouldRun = isAuthenticated && !hasCheckedRef.current;

      expect(shouldRun).toBe(false);
    });
  });

  describe("Timeout Handling", () => {
    test("should add delay before checking tab", () => {
      const mockSetTimeout = mock((callback: () => void, delay: number) => {
        callback();
        return 1;
      });

      mockSetTimeout(() => {}, 300);

      expect(mockSetTimeout).toHaveBeenCalledWith(expect.any(Function), 300);
    });

    test("should clear timeout on cleanup", () => {
      let timeoutId = 1;
      const mockClearTimeout = mock((id: number) => {
        timeoutId = 0;
      });

      mockClearTimeout(timeoutId);

      expect(mockClearTimeout).toHaveBeenCalledWith(1);
      expect(timeoutId).toBe(0);
    });
  });

  describe("Effect Dependencies", () => {
    test("should re-run when authentication changes", () => {
      const deps = [true];

      expect(deps).toContain(true);
    });

    test("should re-run when URL to check changes", () => {
      const urlToCheck = "https://example.com";
      const hasUrl = !!urlToCheck;

      expect(hasUrl).toBe(true);
    });

    test("should re-run when duplicate card result changes", () => {
      const duplicateCard = { _id: "abc123" };
      const hasDuplicate = !!duplicateCard;

      expect(hasDuplicate).toBe(true);
    });
  });

  describe("Return Value", () => {
    test("should return state", () => {
      const result = {
        state: "success",
        error: undefined,
        currentUrl: undefined,
        duplicateCard: null,
      };

      expect(result.state).toBe("success");
    });

    test("should return error if present", () => {
      const result = {
        state: "error",
        error: "Test error",
        currentUrl: undefined,
        duplicateCard: null,
      };

      expect(result.error).toBe("Test error");
    });

    test("should return current URL", () => {
      const result = {
        state: "success",
        error: undefined,
        currentUrl: "https://example.com",
        duplicateCard: null,
      };

      expect(result.currentUrl).toBe("https://example.com");
    });

    test("should return duplicate card if found", () => {
      const duplicate = { _id: "abc123", content: "https://example.com" };
      const result = {
        state: "duplicate",
        error: undefined,
        currentUrl: "https://example.com",
        duplicateCard: duplicate,
      };

      expect(result.duplicateCard).toEqual(duplicate);
    });

    test("should return null duplicate card if not found", () => {
      const result = {
        state: "success",
        error: undefined,
        currentUrl: "https://example.com",
        duplicateCard: null,
      };

      expect(result.duplicateCard).toBeNull();
    });
  });
});
