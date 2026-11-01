export const WORKOS_CLIENT_ID = /^client_[A-Za-z0-9]+$/;
export const WORKOS_USER_ID = /^user_[A-Za-z0-9]+$/;
export const WORKOS_SESSION_ID = /^session_[A-Za-z0-9]+$/;
// WorkOS pages a user's sessions by the bare ULID of the page's last session,
// without `session_`. It ignores a cursor it doesn't recognize and starts
// again from the first page, so a wrong cursor would loop, not fail.
export const WORKOS_SESSION_CURSOR = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const CONNECT_CONSENT_ID = /^app_consent_[A-Za-z0-9]+$/;

export const normalizeIdentityEmail = (email: string): string =>
  email.trim().toLowerCase();

export const isStorableEmail = (email: string): boolean =>
  email.length <= 320 &&
  /^[^\s@]+@[^\s@]+$/.test(email) &&
  !/\p{Cc}/u.test(email);

// The WorkOS name: its full name when set (accounts imported into WorkOS
// carry only that), else first and last name, trimmed; null when all are blank.
export const workosDisplayName = (
  fullName: unknown,
  firstName: unknown,
  lastName: unknown
): string | null => {
  const clean = (part: unknown) =>
    typeof part === "string" ? part.trim() : "";
  const name =
    clean(fullName) ||
    [firstName, lastName].map(clean).filter(Boolean).join(" ");
  return name ? name.slice(0, 256) : null;
};
