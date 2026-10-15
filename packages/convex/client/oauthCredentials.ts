// Credential rules shared by the CLI and the browser extension. Not part of
// the published SDK (`./sdk.ts` does not export it).
import type { ConnectTokenResult } from "./workosConnect";

export interface CredentialBinding {
  clientId: string;
  issuer: string;
  origin: string;
}

// Credentials saved before Teak moved to WorkOS are unbound or bound to a
// non-WorkOS client. No Teak service accepts them, so sign-out clears them
// locally without contacting a server.
export const isWorkosCredential = (
  saved: Partial<CredentialBinding> | undefined
): saved is CredentialBinding =>
  Boolean(
    saved?.origin && saved.issuer && saved.clientId?.startsWith("client_")
  );

export const matchesBinding = (
  saved: Partial<CredentialBinding> | undefined,
  current: CredentialBinding
): boolean =>
  saved?.origin === current.origin &&
  saved.issuer === current.issuer &&
  saved.clientId === current.clientId;

// Only a refresh token the server proved dead lets sign-out forget the
// credentials without confirming remote revocation. Any other failure keeps
// them so the user can retry.
export const isRefreshTokenDead = (result: ConnectTokenResult): boolean =>
  !result.ok && result.reason === "refresh_token_rejected";

// A refresh rotates the refresh token and invalidates the one sent, so the
// replacement is saved before any later step, such as a failed disconnect or
// discovery outage, can lose it.
export const refreshAndSave = async <T>(
  refresh: () => Promise<T>,
  save: (renewed: NonNullable<T>) => unknown
): Promise<T> => {
  const renewed = await refresh();
  if (renewed !== null && renewed !== undefined) {
    await save(renewed);
  }
  return renewed;
};
