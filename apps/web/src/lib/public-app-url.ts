import {
  isLocalDevelopmentHostname,
  resolveTeakDevAppUrl,
} from "@teak/config/dev-urls";

export const resolvePublicAppOrigin = (requestUrl: URL): string => {
  if (isLocalDevelopmentHostname(requestUrl.hostname)) {
    return resolveTeakDevAppUrl(process.env);
  }

  return requestUrl.origin;
};

export const buildPublicAppUrl = (pathname: string, requestUrl: URL): URL =>
  new URL(pathname, `${resolvePublicAppOrigin(requestUrl)}/`);
