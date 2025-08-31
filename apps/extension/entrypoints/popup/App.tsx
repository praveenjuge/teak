import { UserButton, useUser } from "@clerk/chrome-extension";
import { useAutoSaveUrl } from "../../hooks/useAutoSaveUrl";

function App() {
  const { isLoaded, user } = useUser();

  // Only use the auto-save hook when user is fully loaded and authenticated
  const shouldAutoSave = isLoaded && !!user;
  const { state, error } = useAutoSaveUrl(shouldAutoSave);

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center p-4">
        <span className="text-sm text-gray-500">Loading...</span>
      </div>
    );
  }

  const renderAutoSaveStatus = () => {
    switch (state) {
      case "loading":
        return (
          <div className="size-96 flex items-center justify-center gap-2 p-3">
            <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin"></div>
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
                className="w-4 h-4 text-red-500"
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
            <span className="text-sm text-gray-700">Can't save this page</span>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="size-96 relative">
      <div className="absolute bottom-0 w-full left-0 right-0 p-3 flex justify-between items-center">
        <a
          href="https://app.teakvault.com"
          target="_blank"
          rel="noopener noreferrer"
          title="Open Teak"
        >
          <img src="./wxt.svg" alt="Teak Logo" className="size-8" />
        </a>
        <UserButton />
      </div>
      {renderAutoSaveStatus()}
    </div>
  );
}

export default App;
