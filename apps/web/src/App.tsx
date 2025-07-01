import { authClient } from "./lib/auth-client";

function App() {
  const { data: session } = authClient.useSession();

  return (
    <main className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4">
        <header className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-800 mb-4">
            🌿 Teak - Better Auth Demo
          </h1>
          <p className="text-lg text-gray-600">
            Modern Authentication with Better Auth + Hono + PostgreSQL
          </p>
        </header>

        <div className="max-w-2xl mx-auto">
          {session?.user && (
            <div className="mt-8 p-6 bg-white rounded-lg shadow-lg">
              <h3 className="text-xl font-semibold mb-4">🔗 API Testing</h3>
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium text-gray-700">
                    Protected Route Test:
                  </h4>
                  <button
                    onClick={async () => {
                      try {
                        const response = await fetch(
                          "http://localhost:3001/api/protected",
                          {
                            credentials: "include",
                          }
                        );
                        const data = await response.json();
                        alert(JSON.stringify(data, null, 2));
                      } catch (err) {
                        alert("Error: " + err);
                      }
                    }}
                    className="mt-2 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                  >
                    Test Protected Route
                  </button>
                </div>

                <div>
                  <h4 className="font-medium text-gray-700">Session Info:</h4>
                  <button
                    onClick={async () => {
                      try {
                        const response = await fetch(
                          "http://localhost:3001/api/session",
                          {
                            credentials: "include",
                          }
                        );
                        const data = await response.json();
                        alert(JSON.stringify(data, null, 2));
                      } catch (err) {
                        alert("Error: " + err);
                      }
                    }}
                    className="mt-2 bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
                  >
                    Get Session Info
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="mt-8 p-6 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="text-lg font-semibold text-blue-800 mb-3">
              📝 Setup Notes
            </h3>
            <ul className="text-sm text-blue-700 space-y-2">
              <li>✅ Better Auth integrated with Hono backend</li>
              <li>✅ PostgreSQL database with auto-generated tables</li>
              <li>
                ✅ Email/password authentication (no verification required)
              </li>
              <li>
                ⚠️ Email service not configured (emails logged to console)
              </li>
              <li>🔒 Protected API routes working with session middleware</li>
              <li>🍪 Secure cookie-based sessions</li>
            </ul>
          </div>

          <div className="mt-6 p-4 bg-gray-100 rounded-lg">
            <h4 className="font-medium text-gray-700 mb-2">🚀 Next Steps:</h4>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Add email service (Resend, SendGrid, AWS SES)</li>
              <li>• Enable email verification</li>
              <li>• Add social login providers (Google, GitHub, etc.)</li>
              <li>• Implement password reset functionality</li>
              <li>• Add user roles and permissions</li>
              <li>• Set up 2FA with Better Auth plugins</li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}

export default App;
