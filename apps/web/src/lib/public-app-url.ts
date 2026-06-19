import {
  isLocalDevelopmentHostname,
  resolveTeakDevAppUrl,
} from "@teak/convex/dev-urls";

export const resolvePublicAppOrigin = (requestUrl: URL): string => {
  if (isLocalDevelopmentHostname(requestUrl.hostname)) {
    const publicDevUrl = new URL(resolveTeakDevAppUrl(process.env));
    publicDevUrl.protocol = requestUrl.protocol;
    return publicDevUrl.origin;
  }

  return requestUrl.origin;
};

export const buildPublicAppUrl = (pathname: string, requestUrl: URL): URL =>
  new URL(pathname, `${resolvePublicAppOrigin(requestUrl)}/`);
