// Shapes of WorkOS identifiers and addresses Teak accepts at its boundaries.

export const WORKOS_USER_ID = /^user_[A-Za-z0-9]+$/;
export const WORKOS_SESSION_ID = /^session_[A-Za-z0-9]+$/;
export const CONNECT_CONSENT_ID = /^app_consent_[A-Za-z0-9]+$/;

export const normalizeIdentityEmail = (email: string): string =>
  email.trim().toLowerCase();

// An address Teak may store: bounded, one @, no whitespace or control characters.
export const isStorableEmail = (email: string): boolean =>
  email.length <= 320 &&
  /^[^\s@]+@[^\s@]+$/.test(email) &&
  !/\p{Cc}/u.test(email);
