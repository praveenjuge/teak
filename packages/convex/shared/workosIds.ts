export const WORKOS_CLIENT_ID = /^client_[A-Za-z0-9]+$/;
export const WORKOS_USER_ID = /^user_[A-Za-z0-9]+$/;
export const WORKOS_SESSION_ID = /^session_[A-Za-z0-9]+$/;
export const CONNECT_CONSENT_ID = /^app_consent_[A-Za-z0-9]+$/;

export const normalizeIdentityEmail = (email: string): string =>
  email.trim().toLowerCase();

export const isStorableEmail = (email: string): boolean =>
  email.length <= 320 &&
  /^[^\s@]+@[^\s@]+$/.test(email) &&
  !/\p{Cc}/u.test(email);
