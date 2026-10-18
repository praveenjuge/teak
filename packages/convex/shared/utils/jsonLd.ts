export const serializeJsonLd = (schema: object | readonly object[]): string =>
  JSON.stringify(
    Array.isArray(schema)
      ? {
          "@context": "https://schema.org",
          "@graph": schema.map((item: object) => {
            const { "@context": _, ...rest } = item as Record<string, unknown>;
            return rest;
          }),
        }
      : schema
  ).replace(/</g, "\\u003c");
