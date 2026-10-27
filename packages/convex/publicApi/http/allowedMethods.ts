import { openApiSpec } from "../openApi/spec";

const METHOD_ORDER = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

// `/v1/cards/{cardId}/done` matches one path segment per `{param}`.
const templates = Object.entries(openApiSpec.paths).map(
  ([template, operations]) => ({
    methods: new Set(Object.keys(operations).map((m) => m.toUpperCase())),
    pattern: new RegExp(
      `^${template.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{\w+\}/g, "[^/]+")}$`
    ),
  })
);

/**
 * The methods the API documents for a path, or none when the path isn't one
 * of its endpoints. Answers 405 against 404 for a request no route took.
 */
export const allowedMethodsFor = (pathname: string): string[] => {
  const methods = new Set<string>();
  for (const { methods: documented, pattern } of templates) {
    if (pattern.test(pathname)) {
      for (const method of documented) {
        methods.add(method);
      }
    }
  }
  return METHOD_ORDER.filter((method) => methods.has(method));
};
