import { useUser, UserButton } from "@clerk/chrome-extension"

export default function Home() {
  const { user } = useUser()

  if (!user) {
    return (
      <div className="flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Loading user information...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Teak Extension</h1>
        <UserButton />
      </div>
      
      <div className="bg-gray-50 rounded-lg p-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">
            Email
          </label>
          <p className="text-sm text-gray-900 font-mono">
            {user.primaryEmailAddress?.emailAddress || "No email"}
          </p>
        </div>
        
        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">
            User ID
          </label>
          <p className="text-xs text-gray-900 font-mono break-all">
            {user.id}
          </p>
        </div>
      </div>
      
      <div className="text-center pt-2">
        <p className="text-xs text-gray-500">
          Your personal knowledge hub is ready
        </p>
      </div>
    </div>
  )
}