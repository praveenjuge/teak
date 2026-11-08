import { validateOAuthUrl } from "teak-sdk";
import { getApiUrl, getConvexSiteUrl } from "./env";

const baseUrl = (url: string) => {
  const parsed = validateOAuthUrl(url, Boolean(import.meta.env.DEV));
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
};

/** The Teak API base URL: an origin, or an origin and a path such as `/api`. */
export const teakSite = () => baseUrl(getApiUrl());

/**
 * The deployment's Convex site URL: it names development storage, so a dev
 * build pointed at another API URL still finds its sign-in, and sign-ins
 * saved before `teakSite` moved to the API URL are bound to it.
 */
export const convexSite = () => baseUrl(getConvexSiteUrl());
export const siteStorageKey = (name: string) =>
  import.meta.env.DEV ? `${name}:${convexSite()}` : name;
export const captureOwnerKey = () => siteStorageKey("teakOAuthOwner");

export async function getCaptureOwner(): Promise<string | undefined> {
  const owner = (await chrome.storage.local.get(captureOwnerKey()))[
    captureOwnerKey()
  ];
  return typeof owner === "string" ? owner : undefined;
}
