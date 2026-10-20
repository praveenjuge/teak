import { validateOAuthUrl } from "teak-sdk";
import { getConvexSiteUrl } from "./env";

let selectedSite: string | undefined;
export const teakSite = () => {
  selectedSite ??= validateOAuthUrl(
    getConvexSiteUrl(),
    Boolean(import.meta.env.DEV)
  ).origin;
  return selectedSite;
};
export const siteStorageKey = (name: string) =>
  import.meta.env.DEV ? `${name}:${teakSite()}` : name;
export const captureOwnerKey = () => siteStorageKey("teakOAuthOwner");

export async function getCaptureOwner(): Promise<string | undefined> {
  const owner = (await chrome.storage.local.get(captureOwnerKey()))[
    captureOwnerKey()
  ];
  return typeof owner === "string" ? owner : undefined;
}
