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
  const { user, isLoaded } = useUser()
  const cardCount = useQuery(api.cards.getCardCount)

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center p-4">
        <span className="text-sm text-gray-500">Loading...</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-3 p-4">
      <UserButton />
      <span className="text-sm font-medium">
        {user?.emailAddresses?.[0]?.emailAddress || "No email found"}
      </span>
      {cardCount}
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
        <div className="w-80 h-80 flex items-center justify-center">
          <SignedOut>
            <div className="flex flex-col items-center gap-4 p-6">
              <h2 className="text-lg font-semibold text-gray-800">
                Sign in to Teak
              </h2>
              <SignInButton mode="modal">
                <button className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors">
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
