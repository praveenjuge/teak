import { validateOAuthUrl } from "teak-sdk";
import { getApiUrl, getConvexSiteUrl } from "./env";

const baseUrl = (url: string) => {
  const parsed = validateOAuthUrl(url, Boolean(import.meta.env.DEV));
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
};

/** The Teak API base URL: an origin, or an origin and a path such as `/api`. */
export const teakSite = () => baseUrl(getApiUrl());

/** The Convex site URL, which sign-ins saved before `teakSite` moved are bound to. */
export const legacyTeakSite = () => baseUrl(getConvexSiteUrl());
export const siteStorageKey = (name: string) =>
  import.meta.env.DEV ? `${name}:${teakSite()}` : name;
export const captureOwnerKey = () => siteStorageKey("teakOAuthOwner");

export async function getCaptureOwner(): Promise<string | undefined> {
  const owner = (await chrome.storage.local.get(captureOwnerKey()))[
    captureOwnerKey()
  ];
  return typeof owner === "string" ? owner : undefined;
}
