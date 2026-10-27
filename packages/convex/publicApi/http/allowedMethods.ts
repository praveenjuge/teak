import { openApiSpec } from "../openApi/spec";

const METHOD_ORDER = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

const templates = Object.entries(openApiSpec.paths).map(
  ([template, operations]) => ({
    methods: new Set(Object.keys(operations).map((m) => m.toUpperCase())),
    segments: template.split("/"),
  })
);

// `/v1/cards/{cardId}/done` matches one non-empty path segment per `{param}`.
const matchesTemplate = (segments: readonly string[], path: string[]) =>
  segments.length === path.length &&
  segments.every((segment, index) =>
    segment.startsWith("{") ? path[index] !== "" : segment === path[index]
  );

/**
 * The methods the API documents for a path, or none when the path isn't one
 * of its endpoints. Answers 405 against 404 for a request no route took.
 */
export const allowedMethodsFor = (pathname: string): string[] => {
  const path = pathname.split("/");
  const methods = new Set<string>();
  for (const template of templates) {
    if (matchesTemplate(template.segments, path)) {
      for (const method of template.methods) {
        methods.add(method);
      }
    }
  }
  return METHOD_ORDER.filter((method) => methods.has(method));
};
