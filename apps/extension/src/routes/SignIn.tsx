import { SignIn as ClerkSignIn } from "@clerk/chrome-extension"

export default function SignIn() {
  return (
    <div className="flex flex-col items-center justify-center space-y-4">
      <div className="text-center mb-4">
        <h1 className="text-xl font-semibold text-gray-900">Welcome to Teak</h1>
        <p className="text-sm text-gray-600">
          Sign in to access your knowledge hub
        </p>
      </div>
      <ClerkSignIn
        routing="virtual"
        signUpUrl="#"
        fallbackRedirectUrl={chrome.runtime.getURL("popup.html")}
        forceRedirectUrl={chrome.runtime.getURL("popup.html")}
      />
    </div>
  )
}
