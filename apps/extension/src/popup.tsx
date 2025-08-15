import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignInButton,
  useAuth,
  UserButton,
  useUser
} from "@clerk/chrome-extension"
import { api } from "@teak/convex"
import { ConvexReactClient, useQuery } from "convex/react"
import { ConvexProviderWithClerk } from "convex/react-clerk"

import { useAutoSaveLink } from "./hooks/useAutoSaveLink"

import "~style.css"

const convex = new ConvexReactClient(process.env.PLASMO_PUBLIC_CONVEX_URL!, {
  unsavedChangesWarning: false
})

const PUBLISHABLE_KEY = process.env.PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY
const SYNC_HOST = process.env.PLASMO_PUBLIC_CLERK_SYNC_HOST

if (!PUBLISHABLE_KEY) {
  throw new Error(
    "Please add the PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY to the .env.development file"
  )
}

const EXTENSION_URL = chrome.runtime.getURL(".")

function UserInfo() {
  const { isLoaded, user } = useUser()
  const cardCount = useQuery(api.cards.getCardCount)

  // Only use the auto-save hook when user is fully loaded and authenticated
  const shouldAutoSave = isLoaded && !!user
  const { state, error, currentUrl } = useAutoSaveLink(shouldAutoSave)

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center p-4">
        <span className="text-sm text-gray-500">Loading...</span>
      </div>
    )
  }

  const renderSaveStatus = () => {
    switch (state) {
      case "loading":
        return (
          <div className="flex items-center gap-2 p-3 bg-orange-50 rounded-lg">
            <div className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-sm text-orange-700">Adding to Teak...</span>
          </div>
        )
      case "success":
        return (
          <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg">
            <svg
              className="w-4 h-4 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span className="text-sm text-green-700">Added to Teak!</span>
          </div>
        )
      case "error":
        return (
          <div className="flex flex-col gap-1 p-3 bg-red-50 rounded-lg">
            <div className="flex items-center gap-2">
              <svg
                className="w-4 h-4 text-red-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24">
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
        )
      case "invalid-url":
        return (
          <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
            <svg
              className="w-4 h-4 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-sm text-gray-700">Can't save this page</span>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="flex flex-col items-center gap-3 p-4">
      <UserButton />
      {renderSaveStatus()}
      <span className="text-sm font-medium">{cardCount} Cards</span>
    </div>
  )
}

function IndexPopup() {
  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      syncHost={SYNC_HOST}
      afterSignOutUrl={`${EXTENSION_URL}/popup.html`}
      signInFallbackRedirectUrl={`${EXTENSION_URL}/popup.html`}
      signUpFallbackRedirectUrl={`${EXTENSION_URL}/popup.html`}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <div className="w-80 min-h-56 h-full">
          <SignedOut>
            <div className="flex flex-col items-center gap-4 p-6">
              <h2 className="text-lg font-semibold text-gray-800">
                Sign in to Teak
              </h2>
              <SignInButton mode="modal">
                <button className="px-4 py-2 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 transition-colors">
                  Sign In
                </button>
              </SignInButton>
            </div>
          </SignedOut>
          <SignedIn>
            <UserInfo />
          </SignedIn>
        </div>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  )
}

export default IndexPopup
