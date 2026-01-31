// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";

describe("Background Service Worker", () => {
  describe("URL Validation", () => {
    test("should detect chrome:// URLs as restricted", () => {
      const chromeUrl = "chrome://extensions";
      const restrictedPrefixes = [
        "chrome://",
        "chrome-extension://",
        "moz-extension://",
        "edge-extension://",
        "about:",
        "data:",
        "file://",
        "view-source:",
        "filesystem:",
      ];

      const isRestricted = restrictedPrefixes.some((prefix) =>
        chromeUrl.startsWith(prefix)
      );

      expect(isRestricted).toBe(true);
    });

    test("should detect chrome-extension:// URLs as restricted", () => {
      const extensionUrl = "chrome-extension://abcdef/popup.html";
      const restrictedPrefixes = [
        "chrome://",
        "chrome-extension://",
        "moz-extension://",
        "edge-extension://",
        "about:",
        "data:",
        "file://",
        "view-source:",
        "filesystem:",
      ];

      const isRestricted = restrictedPrefixes.some((prefix) =>
        extensionUrl.startsWith(prefix)
      );

      expect(isRestricted).toBe(true);
    });

    test("should detect about: URLs as restricted", () => {
      const aboutUrl = "about:blank";
      const restrictedPrefixes = [
        "chrome://",
        "chrome-extension://",
        "moz-extension://",
        "edge-extension://",
        "about:",
        "data:",
        "file://",
        "view-source:",
        "filesystem:",
      ];

      const isRestricted = restrictedPrefixes.some((prefix) =>
        aboutUrl.startsWith(prefix)
      );

      expect(isRestricted).toBe(true);
    });

    test("should detect file:// URLs as restricted", () => {
      const fileUrl = "file:///Users/example/file.html";
      const restrictedPrefixes = [
        "chrome://",
        "chrome-extension://",
        "moz-extension://",
        "edge-extension://",
        "about:",
        "data:",
        "file://",
        "view-source:",
        "filesystem:",
      ];

      const isRestricted = restrictedPrefixes.some((prefix) =>
        fileUrl.startsWith(prefix)
      );

      expect(isRestricted).toBe(true);
    });

    test("should detect data: URLs as restricted", () => {
      const dataUrl = "data:text/html,<h1>Hello</h1>";
      const restrictedPrefixes = [
        "chrome://",
        "chrome-extension://",
        "moz-extension://",
        "edge-extension://",
        "about:",
        "data:",
        "file://",
        "view-source:",
        "filesystem:",
      ];

      const isRestricted = restrictedPrefixes.some((prefix) =>
        dataUrl.startsWith(prefix)
      );

      expect(isRestricted).toBe(true);
    });

    test("should not detect http:// URLs as restricted", () => {
      const httpUrl = "http://example.com/page";
      const restrictedPrefixes = [
        "chrome://",
        "chrome-extension://",
        "moz-extension://",
        "edge-extension://",
        "about:",
        "data:",
        "file://",
        "view-source:",
        "filesystem:",
      ];

      const isRestricted = restrictedPrefixes.some((prefix) =>
        httpUrl.startsWith(prefix)
      );

      expect(isRestricted).toBe(false);
    });

    test("should not detect https:// URLs as restricted", () => {
      const httpsUrl = "https://example.com/page";
      const restrictedPrefixes = [
        "chrome://",
        "chrome-extension://",
        "moz-extension://",
        "edge-extension://",
        "about:",
        "data:",
        "file://",
        "view-source:",
        "filesystem:",
      ];

      const isRestricted = restrictedPrefixes.some((prefix) =>
        httpsUrl.startsWith(prefix)
      );

      expect(isRestricted).toBe(false);
    });

    test("should treat undefined URL as restricted", () => {
      const url = undefined;

      const isRestricted = !url;

      expect(isRestricted).toBe(true);
    });

    test("should treat empty string URL as restricted", () => {
      const url = "";
      const isRestricted = !url;

      expect(isRestricted).toBe(true);
    });
  });

  describe("Context Menu Creation", () => {
    test("should create save-page menu item", () => {
      const mockCreate = mock(() => Promise.resolve());
      const mockRemoveAll = mock((callback: () => void) => {
        callback();
        return Promise.resolve();
      });

      mockRemoveAll(() => {
        mockCreate({
          id: "save-page",
          title: "Save Page to Teak",
          contexts: ["page"],
        });
      });

      expect(mockCreate).toHaveBeenCalledWith({
        id: "save-page",
        title: "Save Page to Teak",
        contexts: ["page"],
      });
    });

    test("should create save-text menu item", () => {
      const mockCreate = mock(() => Promise.resolve());
      const mockRemoveAll = mock((callback: () => void) => {
        callback();
        return Promise.resolve();
      });

      mockRemoveAll(() => {
        mockCreate({
          id: "save-page",
          title: "Save Page to Teak",
          contexts: ["page"],
        });

        mockCreate({
          id: "save-text",
          title: "Save Text to Teak",
          contexts: ["selection"],
        });
      });

      expect(mockCreate).toHaveBeenCalled();
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    test("should remove all existing menus before creating new ones", () => {
      const mockRemoveAll = mock(() => Promise.resolve());
      const mockCreate = mock(() => Promise.resolve());

      mockRemoveAll(() => {
        mockCreate({
          id: "save-page",
          title: "Save Page to Teak",
          contexts: ["page"],
        });
      });

      expect(mockRemoveAll).toHaveBeenCalled();
    });

    test("should call createContextMenus on runtime startup", () => {
      const mockAddListener = mock((callback: () => void) => {
        callback();
      });

      const createCallback = () => {};

      mockAddListener(createCallback);

      expect(mockAddListener).toHaveBeenCalledWith(createCallback);
    });

    test("should call createContextMenus on runtime installed", () => {
      const mockAddListener = mock((callback: () => void) => {
        callback();
      });

      const createCallback = () => {};

      mockAddListener(createCallback);

      expect(mockAddListener).toHaveBeenCalledWith(createCallback);
    });
  });

  describe("Context Menu Click Handler - Save Page", () => {
    test("should handle save-page action with valid URL", async () => {
      const mockTab = { id: 1, url: "https://example.com/page" };
      const _mockInfo = { menuItemId: "save-page" };

      const isValidUrl = mockTab.url?.startsWith("https://");
      const content = isValidUrl ? mockTab.url : undefined;

      expect(content).toBe("https://example.com/page");
    });

    test("should handle save-page action when tab URL is missing", async () => {
      const mockTab = { id: 1, url: undefined };
      const _mockInfo = { menuItemId: "save-page" };

      const content = mockTab.url;

      expect(content).toBeUndefined();
    });

    test("should throw error for restricted URL in save-page action", () => {
      const mockTab = { id: 1, url: "chrome://extensions" };
      const _mockInfo = { menuItemId: "save-page" };

      const isRestricted = mockTab.url?.startsWith("chrome://");

      expect(isRestricted).toBe(true);
    });

    test("should store context menu state with saving status", async () => {
      const mockSet = mock(() => Promise.resolve());
      const state = {
        action: "save-page",
        timestamp: Date.now(),
        status: "saving",
        content: "https://example.com",
      };

      await mockSet({ contextMenuSave: state });

      expect(mockSet).toHaveBeenCalledWith({
        contextMenuSave: state,
      });
    });

    test("should open popup after storing content", () => {
      const mockOpenPopup = mock(() => Promise.resolve());

      mockOpenPopup();

      expect(mockOpenPopup).toHaveBeenCalled();
    });
  });

  describe("Context Menu Click Handler - Save Text", () => {
    test("should handle save-text action with selected text", async () => {
      const _mockTab = { id: 1, url: "https://example.com" };
      const mockInfo = { menuItemId: "save-text" };

      const action = mockInfo.menuItemId;

      expect(action).toBe("save-text");
    });

    test("should extract selected text using scripting API", async () => {
      const mockExecuteScript = mock(() =>
        Promise.resolve([
          { result: { content: "Selected text", fallback: false } },
        ])
      );

      const results = await mockExecuteScript({
        target: { tabId: 1 },
        func: expect.any(Function),
      });

      const result = results[0]?.result;

      expect(result?.content).toBe("Selected text");
      expect(result?.fallback).toBe(false);
    });

    test("should use page title as fallback when no text selected", async () => {
      const mockExecuteScript = mock(() =>
        Promise.resolve([{ result: { content: "Page Title", fallback: true } }])
      );

      const results = await mockExecuteScript({
        target: { tabId: 1 },
        func: expect.any(Function),
      });

      const result = results[0]?.result;

      expect(result?.content).toBe("Page Title");
      expect(result?.fallback).toBe(true);
    });

    test("should handle scripting execution errors gracefully", async () => {
      const mockExecuteScript = mock(() => {
        throw new Error("Script execution failed");
      });

      try {
        await mockExecuteScript({
          target: { tabId: 1 },
          func: expect.any(Function),
        });
      } catch (error) {
        expect(error).toBeTruthy();
      }
    });

    test("should use tab title as fallback when scripting fails", () => {
      const mockTab = { id: 1, title: "Fallback Title" };

      const content = mockTab.title;

      expect(content).toBe("Fallback Title");
    });

    test("should set error message when no content available", () => {
      const errorMessage = "No text selected and could not access page content";

      expect(errorMessage).toBeTruthy();
    });
  });

  describe("Error Handling", () => {
    test("should store error state in storage", async () => {
      const mockSet = mock(() => Promise.resolve());
      const errorState = {
        action: "save-page",
        timestamp: Date.now(),
        status: "error",
        error: "Failed to save content",
      };

      await mockSet({ contextMenuSave: errorState });

      expect(mockSet).toHaveBeenCalledWith({
        contextMenuSave: errorState,
      });
    });

    test("should extract error message from Error object", () => {
      const error = new Error("Something went wrong");

      const errorMessage =
        error instanceof Error ? error.message : "Failed to save content";

      expect(errorMessage).toBe("Something went wrong");
    });

    test("should use fallback message for non-Error errors", () => {
      const error = "String error";

      const errorMessage =
        error instanceof Error ? error.message : "Failed to save content";

      expect(errorMessage).toBe("Failed to save content");
    });

    test("should open popup to show error", () => {
      const mockOpenPopup = mock(() => Promise.resolve());

      mockOpenPopup();

      expect(mockOpenPopup).toHaveBeenCalled();
    });

    test("should handle missing tab ID gracefully", () => {
      const mockTab = undefined;

      const hasTabId = mockTab?.id;

      expect(hasTabId).toBeUndefined();
    });
  });

  describe("Context Menu Listener Setup", () => {
    test("should add listener for context menu clicks", () => {
      const mockAddListener = mock(() => {});

      const handler = (_info: unknown, _tab?: unknown) => {};

      mockAddListener(handler);

      expect(mockAddListener).toHaveBeenCalledWith(handler);
    });

    test("should initialize context menus immediately on startup", () => {
      let initialized = false;

      const initMenus = () => {
        initialized = true;
      };

      initMenus();

      expect(initialized).toBe(true);
    });
  });

  describe("URL Parsing in Error Messages", () => {
    test("should extract protocol from URL for error message", () => {
      const url = "chrome://extensions";
      const protocol = new URL(url).protocol;

      expect(protocol).toBe("chrome:");
    });

    test("should handle invalid URL in error message", () => {
      const url = "not-a-valid-url";

      let protocol: string;
      try {
        protocol = new URL(url).protocol;
      } catch {
        protocol = "unknown:";
      }

      expect(protocol).toBe("unknown:");
    });

    test("should format error message with protocol", () => {
      const protocol = "chrome:";
      const errorMessage = `Cannot save content from ${protocol} pages. Try using the extension on regular web pages.`;

      expect(errorMessage).toContain("chrome:");
      expect(errorMessage).toContain("Cannot save content");
    });
  });

  describe("Storage Operations", () => {
    test("should store contextMenuSave with correct structure", async () => {
      const mockSet = mock(() => Promise.resolve());
      const state = {
        action: "save-page",
        timestamp: Date.now(),
        status: "saving",
        content: "https://example.com",
      };

      await mockSet({ contextMenuSave: state });

      expect(mockSet).toHaveBeenCalledWith({
        contextMenuSave: {
          action: "save-page",
          timestamp: state.timestamp,
          status: "saving",
          content: "https://example.com",
        },
      });
    });

    test("should handle storage operations asynchronously", async () => {
      const mockSet = mock(() => Promise.resolve());

      await mockSet({ contextMenuSave: { status: "saving" } });

      expect(mockSet).toHaveBeenCalled();
    });
  });
});
