import {
  AuthKitProvider,
  type AuthKitProviderProps,
  useAccessToken,
  useAuth,
} from "@workos/authkit-tanstack-react-start/client";
import { ConvexProviderWithAuth } from "convex/react";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache/provider";
import {
  createContext,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useRef,
} from "react";
import { convex } from "@/lib/convexClient";
import { QuerySeedsProvider } from "@/lib/convexQueryHooks";
import type { QuerySeed } from "@/lib/firstLoadQueries";
import { fetchSessionToken, newerSessionToken } from "@/lib/session-token";

// The access token the page load came with, for Convex's first sign-in.
const PageTokenContext = createContext<string | undefined>(undefined);

export default function ConvexClientProvider({
  children,
  initialAuth,
  initialToken,
  loading = null,
  seeds = [],
}: {
  children: ReactNode;
  initialAuth?: AuthKitProviderProps["initialAuth"];
  initialToken?: string;
  /** Shown while a page load's seeds stream in. */
  loading?: ReactNode;
  seeds?: readonly QuerySeed[] | Promise<readonly QuerySeed[]>;
}) {
  return (
    <AuthKitProvider initialAuth={initialAuth}>
      <PageTokenContext.Provider value={initialToken}>
        <ConvexProviderWithAuth client={convex} useAuth={useAuthFromAuthKit}>
          <Suspense fallback={loading}>
            <QuerySeedsProvider seeds={seeds}>
              <ConvexQueryCacheProvider>{children}</ConvexQueryCacheProvider>
            </QuerySeedsProvider>
          </Suspense>
        </ConvexProviderWithAuth>
      </PageTokenContext.Provider>
    </AuthKitProvider>
  );
}

// The page load's token goes to Convex once per page: a layout that mounts
// again later reads the same loader data, whose token may have expired.
let handedOutPageToken: string | undefined;

function useAuthFromAuthKit() {
  const { user, loading } = useAuth();
  const { getAccessToken, refresh } = useAccessToken();
  const handedOut = useRef<string | null>(null);
  // The page load's token signs Convex in without first asking the server
  // for one; after that, tokens come from AuthKit.
  const initialToken = useContext(PageTokenContext);
  const unusedInitialToken = useRef(initialToken);
  const nextToken = useCallback(
    () => newerSessionToken(handedOut.current, getAccessToken, refresh),
    [getAccessToken, refresh]
  );
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (!user) {
        return null;
      }
      const pageToken = unusedInitialToken.current;
      unusedInitialToken.current = undefined;
      if (pageToken && pageToken !== handedOutPageToken && !forceRefreshToken) {
        handedOutPageToken = pageToken;
        handedOut.current = pageToken;
        return pageToken;
      }
      const token = await fetchSessionToken(
        forceRefreshToken ? nextToken : getAccessToken
      );
      handedOut.current = token;
      return token;
    },
    [user, nextToken, getAccessToken]
  );
  return {
    isLoading: loading,
    isAuthenticated: Boolean(user),
    fetchAccessToken,
  };
}
