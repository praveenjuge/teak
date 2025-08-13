import { ClerkProvider, SignedIn, SignedOut } from "@clerk/chrome-extension"
import { Outlet, useNavigate } from "react-router-dom"

const publishableKey = process.env.PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY

if (!publishableKey) {
  throw new Error("Add your Clerk Publishable key to the .env.local file")
}

const syncHost = process.env.PLASMO_PUBLIC_CLERK_SYNC_HOST

export default function RootLayout() {
  const navigate = useNavigate()

  return (
    <ClerkProvider
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      publishableKey={publishableKey}
      syncHost={syncHost}>
      <div className="min-h-[400px] w-[320px] p-4 bg-white">
        <SignedIn>
          <Outlet />
        </SignedIn>
        <SignedOut>
          <Outlet />
        </SignedOut>
      </div>
    </ClerkProvider>
  )
}
