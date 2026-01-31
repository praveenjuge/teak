// @ts-nocheck
import { describe, expect, test } from "bun:test";

import { getAuthErrorMessage } from "../../lib/getAuthErrorMessage";

describe("getAuthErrorMessage", () => {
  describe("string error handling", () => {
    test("should return string error directly", () => {
      const error = "Invalid credentials";
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("Invalid credentials");
    });

    test("should return trimmed string error", () => {
      const error = "  Invalid credentials  ";
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("  Invalid credentials  ");
    });

    test("should use fallback for empty string", () => {
      const error = "   ";
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("Default error");
    });

    test("should use fallback for empty string with no spaces", () => {
      const error = "";
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("Default error");
    });
  });

  describe("object error handling", () => {
    test("should extract cause field", () => {
      const error = {
        cause: "User already exists",
      };
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("User already exists");
    });

    test("should extract message field", () => {
      const error = {
        message: "Email not verified",
      };
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("Email not verified");
    });

    test("should extract statusText field", () => {
      const error = {
        statusText: "Unauthorized",
      };
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("Unauthorized");
    });

    test("should prioritize cause over message", () => {
      const error = {
        cause: "Cause message",
        message: "Message field",
      };
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("Cause message");
    });

    test("should prioritize message over statusText", () => {
      const error = {
        message: "Message field",
        statusText: "Status text",
      };
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("Message field");
    });

    test("should prioritize statusText over nested error", () => {
      const error = {
        statusText: "Status text",
        error: "Error field",
      };
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("Status text");
    });
  });

  describe("nested error field handling", () => {
    test("should extract string error field", () => {
      const error = {
        error: "Nested error message",
      };
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("Nested error message");
    });

    test("should extract message from nested error object", () => {
      const error = {
        error: {
          message: "Nested error object message",
        },
      };
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("Nested error object message");
    });

    test("should handle empty string error field", () => {
      const error = {
        error: "   ",
      };
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("Default error");
    });

    test("should prioritize top-level fields over nested error", () => {
      const error = {
        cause: "Top-level cause",
        error: "Nested error",
      };
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("Top-level cause");
    });
  });

  describe("null and undefined field handling", () => {
    test("should handle null cause field", () => {
      const error = {
        cause: null,
        message: "Valid message",
      };
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("Valid message");
    });

    test("should handle undefined cause field", () => {
      const error = {
        cause: undefined,
        message: "Valid message",
      };
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("Valid message");
    });

    test("should handle null message field", () => {
      const error = {
        message: null,
        statusText: "Valid status",
      };
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("Valid status");
    });

    test("should handle undefined message field", () => {
      const error = {
        message: undefined,
        statusText: "Valid status",
      };
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("Valid status");
    });

    test("should handle null nested error message", () => {
      const error = {
        error: {
          message: null,
        },
      };
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("Default error");
    });
  });

  describe("fallback message handling", () => {
    test("should return fallback for null error", () => {
      const result = getAuthErrorMessage(null, "Fallback message");
      expect(result).toBe("Fallback message");
    });

    test("should return fallback for undefined error", () => {
      const result = getAuthErrorMessage(undefined, "Fallback message");
      expect(result).toBe("Fallback message");
    });

    test("should return fallback for object with no valid fields", () => {
      const error = {
        randomField: "some value",
      };
      const result = getAuthErrorMessage(error, "Fallback message");
      expect(result).toBe("Fallback message");
    });

    test("should return fallback for empty object", () => {
      const error = {};
      const result = getAuthErrorMessage(error, "Fallback message");
      expect(result).toBe("Fallback message");
    });

    test("should return fallback for number type", () => {
      const error = 12_345;
      const result = getAuthErrorMessage(error, "Fallback message");
      expect(result).toBe("Fallback message");
    });

    test("should return fallback for boolean type", () => {
      const error = true;
      const result = getAuthErrorMessage(error, "Fallback message");
      expect(result).toBe("Fallback message");
    });

    test("should return fallback for array type", () => {
      const error = ["error1", "error2"];
      const result = getAuthErrorMessage(error, "Fallback message");
      expect(result).toBe("Fallback message");
    });
  });

  describe("complex error scenarios", () => {
    test("should handle error with all fields present", () => {
      const error = {
        cause: "Cause message",
        message: "Message text",
        statusText: "Status text",
        error: "Error field",
      };
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("Cause message");
    });

    test("should handle error with mixed null and valid fields", () => {
      const error = {
        cause: null,
        message: null,
        statusText: "Valid status",
        error: null,
      };
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("Valid status");
    });

    test("should handle deeply nested error structure", () => {
      const error = {
        error: {
          message: "Deeply nested message",
        },
        cause: null,
        message: null,
      };
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("Deeply nested message");
    });

    test("should handle error with all null fields", () => {
      const error = {
        cause: null,
        message: null,
        statusText: null,
        error: null,
      };
      const result = getAuthErrorMessage(error, "Default error");
      expect(result).toBe("Default error");
    });
  });
});
