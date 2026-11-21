import { isRedirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { signOut } from "@workos/authkit-tanstack-react-start";
import { signInUrl } from "@/lib/authUrls";
import { configureWorkos } from "@/server/workos";

/**
 * Ends the session and returns WorkOS's logout URL, which comes back to
 * sign-in. AuthKit's signOut clears the session cookie and answers with a
 * redirect; the browser follows it itself, since a fetch can't. The session
 * hint clears on the next request, when the middleware sees no session.
 */
export const signOutWorkos = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ url: string }> => {
    const returnTo = signInUrl(configureWorkos().origin).toString();
    try {
      await signOut({ data: { returnTo } });
    } catch (error) {
      if (isRedirect(error) && error.options.href) {
        return { url: error.options.href };
      }
      throw error;
    }
    return { url: returnTo };
  }
);
