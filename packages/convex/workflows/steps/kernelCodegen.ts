/**
 * Shared escaping helper for values embedded into generated Playwright code
 * executed by Kernel browser sessions. Values are interpolated into
 * single-quoted JavaScript string literals, so backslashes must be escaped
 * first and single quotes second.
 */
export const escapeForSingleQuotedJs = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
