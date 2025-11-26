import { FormEvent, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAutoSaveUrl } from "../../hooks/useAutoSaveUrl";
import { useContextMenuSave } from "../../hooks/useContextMenuSave";
import { authClient } from "../../lib/auth-client";
import { getAuthErrorMessage } from "../../utils/getAuthErrorMessage";

type SessionData = NonNullable<
  ReturnType<typeof authClient.useSession>["data"]
>;

function App() {
  const {
    data: session,
    isPending,
    error: sessionError,
    refetch,
  } = authClient.useSession();

  if (isPending) {
    return (
      <div className="size-96 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-red-600 animate-spin" />
      </div>
    );
  }

  if (sessionError) {
    return (
      <SessionErrorState
        message={getAuthErrorMessage(
          sessionError,
          "We couldn't load your session."
        )}
        onRetry={() => refetch()}
      />
    );
  }

  if (!session) {
    return <AuthPanel />;
  }

  return <AuthenticatedPopup user={session.user} />;
}

function SessionErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="size-96 flex flex-col items-center justify-center gap-4 p-5 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="./icon.svg" alt="Teak Logo" className="h-6" />
      <p className="text-sm text-red-600">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Try again
      </button>
    </div>
  );
}

function AuthPanel() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    if (isGoogleLoading) return;
    setIsGoogleLoading(true);
    setErrorMessage(null);

    try {
      const response = await authClient.signIn.social({
        provider: "google",
      });
      if (response?.error) {
        setErrorMessage(
          getAuthErrorMessage(
            response.error,
            "Failed to sign in with Google. Please try again."
          )
        );
      }
    } catch (error) {
      setErrorMessage(
        getAuthErrorMessage(
          error,
          "Failed to sign in with Google. Please try again."
        )
      );
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    try {
      const response = await authClient.signIn.email({
        email: trimmedEmail,
        password: trimmedPassword,
      });

      if (response?.error) {
        setErrorMessage(
          getAuthErrorMessage(
            response.error,
            "Invalid email or password. Please try again."
          )
        );
      }
    } catch (error) {
      setErrorMessage(
        getAuthErrorMessage(
          error,
          "Invalid email or password. Please try again."
        )
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const isSubmitDisabled =
    isSubmitting || isGoogleLoading || !email.trim() || !password.trim();

  const buttonLabel = isSubmitting ? "Signing in..." : "Sign in";

  return (
    <div className="size-96 flex flex-col items-center justify-center gap-5 p-5 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="./icon.svg" alt="Teak Logo" className="h-6" />
      <div className="space-y-1">
        <h1 className="text-base font-semibold">Save Anything. Anywhere.</h1>
        <p className="text-sm text-gray-500 text-balance">
          Your personal everything management system. Organize, save, and access
          all your text, images, and documents in one place.
        </p>
      </div>

      <form className="w-full space-y-3 text-left" onSubmit={handleSubmit}>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-200"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label
            className="text-xs font-medium text-gray-600"
            htmlFor="password"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-200"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {errorMessage && <p className="text-xs text-red-600">{errorMessage}</p>}

        <button
          type="submit"
          disabled={isSubmitDisabled}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {buttonLabel}
        </button>
      </form>

      <div className="relative my-4 flex items-center">
        <div className="flex-1 border-t border-gray-200" />
        <span className="px-3 text-xs uppercase text-gray-500">
          or continue with
        </span>
        <div className="flex-1 border-t border-gray-200" />
      </div>

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={isSubmitting || isGoogleLoading}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {isGoogleLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
        )}
        {isGoogleLoading ? "Signing in..." : "Continue with Google"}
      </button>
    </div>
  );
}

function AuthenticatedPopup({ user }: { user: SessionData["user"] }) {
  const { state: contextMenuState, isRecentSave } = useContextMenuSave();
  const { state, error } = useAutoSaveUrl(!isRecentSave);
  const [signOutLoading, setSignOutLoading] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  // Auto-close popup after successful save
  useEffect(() => {
    const isAutoSaveSuccess = state === "success";
    const isContextMenuSuccess =
      isRecentSave && contextMenuState.status === "success";

    if (isAutoSaveSuccess || isContextMenuSuccess) {
      const timer = setTimeout(() => {
        window.close();
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [state, isRecentSave, contextMenuState.status]);

  const handleSignOut = async () => {
    if (signOutLoading) return;
    setSignOutLoading(true);
    setSignOutError(null);

    try {
      await authClient.signOut();
    } catch (error) {
      setSignOutError(
        getAuthErrorMessage(error, "Unable to sign out. Please try again.")
      );
    } finally {
      setSignOutLoading(false);
    }
  };

  const renderStatus = () => {
    if (isRecentSave) {
      return renderContextMenuStatus();
    }
    return renderAutoSaveStatus();
  };

  const renderContextMenuStatus = () => {
    const getContextMenuMessage = () => {
      switch (contextMenuState.action) {
        case "save-page":
          return "Page saved!";
        case "save-text":
          return "Text saved!";
        default:
          return "Saved to Teak!";
      }
    };

    switch (contextMenuState.status) {
      case "saving":
        return (
          <div className="size-96 flex items-center justify-center gap-2 p-3">
            <Loader2 className="w-4 h-4 text-red-600 animate-spin" />
            <span className="text-sm text-red-700">Saving to Teak...</span>
          </div>
        );
      case "success":
        return (
          <div className="size-96 flex items-center justify-center gap-2 p-3">
            <svg
              className="w-4 h-4 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="3"
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span className="text-sm text-green-700">
              {getContextMenuMessage()}
            </span>
          </div>
        );
      case "error":
        return (
          <div className="size-96 flex flex-col items-center justify-center gap-1 p-3">
            <div className="flex items-center justify-center gap-2">
              <svg
                className="w-4 h-4 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              <span className="text-sm text-red-700">Failed to save</span>
            </div>
            {contextMenuState.error && (
              <span className="text-xs text-red-600">
                {contextMenuState.error}
              </span>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  const renderAutoSaveStatus = () => {
    switch (state) {
      case "loading":
        return (
          <div className="size-96 flex items-center justify-center gap-2 p-3">
            <Loader2 className="w-4 h-4 text-red-600 animate-spin" />
            <span className="text-sm text-red-700">Adding to Teak...</span>
          </div>
        );
      case "success":
        return (
          <div className="size-96 flex items-center justify-center gap-2 p-3">
            <svg
              className="w-4 h-4 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="3"
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span className="text-sm text-green-700">Added to Teak!</span>
          </div>
        );
      case "error":
        return (
          <div className="size-96 flex flex-col items-center justify-center gap-1 p-3">
            <div className="flex items-center justify-center gap-2">
              <svg
                className="w-4 h-4 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              <span className="text-sm text-red-700">Failed to save</span>
            </div>
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
        );
      case "invalid-url":
        return (
          <div className="size-96 flex items-center justify-center gap-2 p-3">
            <svg
              className="w-4 h-4 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-sm text-gray-700">
              Can&apos;t save this page
            </span>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="size-96 relative">
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-2 p-3">
        <a
          href="https://app.teakvault.com"
          target="_blank"
          rel="noopener noreferrer"
          title="Open Teak"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="./icon.svg" alt="Teak Logo" className="h-4" />
        </a>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1">
            {user?.email}
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signOutLoading}
            className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {signOutLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Sign out
          </button>
        </div>
      </div>

      {renderStatus()}

      {signOutError && (
        <p className="absolute left-1/2 top-2 w-11/12 -translate-x-1/2 rounded-lg bg-red-50 px-3 py-2 text-center text-[11px] text-red-600">
          {signOutError}
        </p>
      )}
    </div>
  );
}

export default App;
