// Earlier builds of the API reference named each operation's page after its
// lowercased operationId (`deletecard`) or its method and path
// (`patch-v1-cards-cardid`). Blume names it after the operationId in kebab
// case (`delete-card`). Search engines still crawl the old addresses, so each
// one redirects to the page that replaced it.

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const OPERATIONS_ROUTE = "/reference/operations";

interface OpenApiSpec {
  paths: Record<string, Partial<Record<string, { operationId?: string }>>>;
}

export interface Redirect {
  from: string;
  status: 301;
  to: string;
}

/** Blume's page slug: a dash before every capital, all lowercase. */
export const operationSlug = (operationId: string): string =>
  operationId.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const methodPathSlug = (method: string, path: string): string =>
  [method, ...path.split("/").filter(Boolean)]
    .join("-")
    .replace(/[{}]/g, "")
    .toLowerCase();

// Operations that no longer exist, pointed at the one that took their place.
const RETIRED: Record<string, string> = {
  "get-v1-cards-search": "listCards",
  searchcards: "listCards",
};

export const legacyReferenceRedirects = (spec: OpenApiSpec): Redirect[] => {
  const targets = new Map<string, string>();
  for (const [path, operations] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const operationId = operations[method]?.operationId;
      if (!operationId) {
        continue;
      }
      const current = operationSlug(operationId);
      for (const legacy of [
        operationId.toLowerCase(),
        methodPathSlug(method, path),
      ]) {
        if (legacy !== current) {
          targets.set(legacy, current);
        }
      }
    }
  }
  for (const [legacy, operationId] of Object.entries(RETIRED)) {
    targets.set(legacy, operationSlug(operationId));
  }
  return [...targets].map(([legacy, current]) => ({
    from: `${OPERATIONS_ROUTE}/${legacy}`,
    status: 301,
    to: `${OPERATIONS_ROUTE}/${current}`,
  }));
};
