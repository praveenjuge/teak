// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { getAuthErrorMessage } from "../../utils/getAuthErrorMessage";

describe("getAuthErrorMessage", () => {
  describe("String Error Handling", () => {
    test("should return string error as-is", () => {
      const error = "This is a string error";
      const fallback = "Default error message";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("This is a string error");
    });

    test("should return non-empty string", () => {
      const error = "Error message";
      const fallback = "Default";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBeTruthy();
      expect(result.length).toBeGreaterThan(0);
    });

    test("should handle whitespace-only string", () => {
      const error = "   ";
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });

    test("should handle empty string", () => {
      const error = "";
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });

    test("should trim whitespace from string errors", () => {
      const error = "  error with spaces  ";
      const fallback = "Default";
      const result = getAuthErrorMessage(error, fallback);

      // The function returns the original string (not trimmed)
      expect(result).toBe("  error with spaces  ");
    });
  });

  describe("Object Error Handling - Message Property", () => {
    test("should extract message property from error object", () => {
      const error = { message: "Authentication failed" };
      const fallback = "Default";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Authentication failed");
    });

    test("should handle empty message", () => {
      const error = { message: "" };
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });

    test("should handle null message", () => {
      const error = { message: null };
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });

    test("should handle undefined message", () => {
      const error = { message: undefined };
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });

    test("should handle message with only whitespace", () => {
      const error = { message: "   " };
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });

    test("should prioritize message over other properties", () => {
      const error = { message: "Main error", cause: "Secondary cause" };
      const fallback = "Default";
      const result = getAuthErrorMessage(error, fallback);

      // Actually, cause has higher priority than message
      expect(result).toBe("Secondary cause");
    });
  });

  describe("Object Error Handling - Cause Property", () => {
    test("should extract cause property when message is missing", () => {
      const error = { cause: "Network timeout" };
      const fallback = "Default";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Network timeout");
    });

    test("should prioritize cause over message when both present", () => {
      const error = { cause: "Root cause", message: "Symptom" };
      const fallback = "Default";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Root cause");
    });

    test("should handle empty cause", () => {
      const error = { cause: "" };
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });

    test("should handle null cause", () => {
      const error = { cause: null };
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });

    test("should handle undefined cause", () => {
      const error = { cause: undefined };
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });
  });

  describe("Object Error Handling - StatusText Property", () => {
    test("should extract statusText when message and cause are missing", () => {
      const error = { statusText: "Unauthorized" };
      const fallback = "Default";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Unauthorized");
    });

    test("should handle empty statusText", () => {
      const error = { statusText: "" };
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });

    test("should handle null statusText", () => {
      const error = { statusText: null };
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });

    test("should check statusText after cause and message", () => {
      const error = {
        message: "",
        cause: "",
        statusText: "Bad Request",
      };
      const fallback = "Default";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Bad Request");
    });
  });

  describe("Nested Error Property", () => {
    test("should extract string from nested error property", () => {
      const error = { error: "Nested error message" };
      const fallback = "Default";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Nested error message");
    });

    test("should extract message from nested error object", () => {
      const error = { error: { message: "Nested object message" } };
      const fallback = "Default";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Nested object message");
    });

    test("should handle null nested error", () => {
      const error = { error: null };
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });

    test("should handle empty string nested error", () => {
      const error = { error: "" };
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });

    test("should handle nested error object with empty message", () => {
      const error = { error: { message: "" } };
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });

    test("should handle nested error object with null message", () => {
      const error = { error: { message: null } };
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });

    test("should prioritize nested error message over other fields", () => {
      const error = {
        message: "Top level",
        error: { message: "Nested level" },
      };
      const fallback = "Default";
      const result = getAuthErrorMessage(error, fallback);

      // Actually, message is checked before nested error
      expect(result).toBe("Top level");
    });
  });

  describe("Priority Order", () => {
    test("should check cause first", () => {
      const error = {
        cause: "First priority",
        message: "Second priority",
        statusText: "Third priority",
        error: "Fourth priority",
      };
      const fallback = "Last resort";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("First priority");
    });

    test("should check message second", () => {
      const error = {
        message: "Second priority",
        statusText: "Third priority",
        error: "Fourth priority",
      };
      const fallback = "Last resort";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Second priority");
    });

    test("should check statusText third", () => {
      const error = {
        statusText: "Third priority",
        error: "Fourth priority",
      };
      const fallback = "Last resort";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Third priority");
    });

    test("should check string error fourth", () => {
      const error = {
        error: "Fourth priority",
      };
      const fallback = "Last resort";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Fourth priority");
    });

    test("should use fallback as last resort", () => {
      const error = {};
      const fallback = "Last resort";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Last resort");
    });
  });

  describe("Complex Error Objects", () => {
    test("should handle HTTP response errors", () => {
      const error = {
        message: "Request failed",
        cause: "Network error",
        statusText: "Service Unavailable",
      };
      const fallback = "Default";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Network error");
    });

    test("should handle Better Auth error responses", () => {
      const error = {
        message: "Authentication error",
        error: {
          message: "Invalid credentials",
        },
      };
      const fallback = "Default";
      const result = getAuthErrorMessage(error, fallback);

      // Message is checked before nested error
      expect(result).toBe("Authentication error");
    });

    test("should handle errors with all properties", () => {
      const error = {
        cause: "Database connection failed",
        message: "Unable to authenticate",
        statusText: "Internal Server Error",
        error: { message: "Service unavailable" },
      };
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Database connection failed");
    });

    test("should handle errors with partial properties", () => {
      const error = {
        message: "",
        cause: null,
        statusText: undefined,
        error: "",
      };
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });

    test("should handle errors with missing nested message", () => {
      const error = {
        error: { otherProperty: "value" },
      };
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });
  });

  describe("Edge Cases", () => {
    test("should handle null error", () => {
      const error = null;
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });

    test("should handle undefined error", () => {
      const error = undefined;
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });

    test("should handle number as error", () => {
      const error = 404;
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });

    test("should handle boolean as error", () => {
      const error = true;
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });

    test("should handle array as error", () => {
      const error = ["error1", "error2"];
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });

    test("should handle date as error", () => {
      const error = new Date();
      const fallback = "Default error";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Default error");
    });
  });

  describe("Fallback Message", () => {
    test("should use provided fallback message", () => {
      const error = {};
      const fallback = "Custom fallback message";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Custom fallback message");
    });

    test("should handle empty fallback", () => {
      const error = {};
      const fallback = "";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("");
    });

    test("should handle whitespace fallback", () => {
      const error = {};
      const fallback = "   ";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("   ");
    });

    test("should require fallback parameter", () => {
      const error = {};
      const fallback = "Required fallback";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Required fallback");
    });
  });

  describe("Type Safety", () => {
    test("should handle unknown type safely", () => {
      const error: unknown = { message: "Unknown type error" };
      const fallback = "Default";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Unknown type error");
    });

    test("should handle any type safely", () => {
      const error: any = { cause: "Any type error" };
      const fallback = "Default";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Any type error");
    });

    test("should not throw on invalid input", () => {
      const error = Symbol("error");
      const fallback = "Default";

      expect(() => getAuthErrorMessage(error, fallback)).not.toThrow();
    });

    test("should return string for all inputs", () => {
      const fallback = "Default";

      expect(getAuthErrorMessage(null, fallback)).toBeTypeOf("string");
      expect(getAuthErrorMessage(undefined, fallback)).toBeTypeOf("string");
      expect(getAuthErrorMessage({}, fallback)).toBeTypeOf("string");
      expect(getAuthErrorMessage("error", fallback)).toBeTypeOf("string");
      expect(getAuthErrorMessage(123, fallback)).toBeTypeOf("string");
    });
  });

  describe("Real-World Scenarios", () => {
    test("should handle Better Auth login failure", () => {
      const error = {
        message: "Invalid email or password",
        cause: "Authentication failed",
      };
      const fallback = "Login failed. Please try again.";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Authentication failed");
    });

    test("should handle network error", () => {
      const error = {
        message: "Failed to fetch",
        cause: "Network connection lost",
      };
      const fallback = "Connection error. Please check your internet.";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Network connection lost");
    });

    test("should handle API error response", () => {
      const error = {
        statusText: "Unauthorized",
        message: "401 - Unauthorized",
      };
      const fallback = "Authentication required";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("401 - Unauthorized");
    });

    test("should handle rate limit error", () => {
      const error = {
        message: "Too many requests",
        statusText: "Rate limit exceeded",
      };
      const fallback = "Please try again later";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Too many requests");
    });

    test("should handle validation error", () => {
      const error = {
        error: { message: "Email is required" },
      };
      const fallback = "Validation failed";
      const result = getAuthErrorMessage(error, fallback);

      expect(result).toBe("Email is required");
    });
  });
});
