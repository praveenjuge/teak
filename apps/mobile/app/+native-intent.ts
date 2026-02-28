import type { NativeIntent } from "expo-router";
import {
  INCOMING_SHARE_ROUTE,
  INCOMING_SHARE_TOKEN,
} from "@/lib/share/constants";

function parsePath(inputPath: string): { host: string; pathname: string } {
  try {
    const parsed = new URL(inputPath);
    return {
      host: parsed.host.toLowerCase(),
      pathname: parsed.pathname.toLowerCase(),
    };
  } catch {
    const normalized = inputPath.toLowerCase();
    return {
      host: "",
      pathname: normalized.startsWith("/") ? normalized : `/${normalized}`,
    };
  }
}

export function resolveIncomingSharePath(inputPath: string): string | null {
  const trimmedPath = inputPath.trim();
  if (!trimmedPath) {
    return null;
  }

  if (trimmedPath.toLowerCase() === INCOMING_SHARE_TOKEN) {
    return INCOMING_SHARE_ROUTE;
  }

  const { host, pathname } = parsePath(trimmedPath);

  if (
    host === INCOMING_SHARE_TOKEN ||
    pathname === `/${INCOMING_SHARE_TOKEN}`
  ) {
    return INCOMING_SHARE_ROUTE;
  }

  return null;
}

export const redirectSystemPath: NativeIntent["redirectSystemPath"] = ({
  path,
}) => {
  const redirected = resolveIncomingSharePath(path);
  return redirected ?? path;
};
