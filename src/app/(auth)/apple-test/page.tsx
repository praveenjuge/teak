"use client";

import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useState } from "react";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { AppleIcon } from "@/components/icons/AppleIcon";

export default function AppleTest() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  // Helper to add log entries
  const addLog = (message: string) => {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    console.log("🍎 APPLE-TEST:", message);
    setLogs((prev) => [...prev, logEntry]);
  };

  const checkSession = async () => {
    console.log("🍎 Checking current session...");
    addLog("Checking current session...");
    try {
      const session = await authClient.getSession();
      console.log("🍎 Current session:", session);
      addLog(`Session check result: ${JSON.stringify(session, null, 2)}`);
      if (session?.data?.user) {
        addLog(`User logged in: ${session.data.user.email}`);
      } else {
        addLog("No active session");
      }
    } catch (err) {
      console.error("🍎 Session check error:", err);
      addLog(
        `Session check error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleAppleSignIn = async () => {
    console.log("🍎 ==========================================");
    console.log("🍎 APPLE SIGN-IN BUTTON CLICKED");
    console.log("🍎 ==========================================");

    addLog("--- APPLE SIGN-IN INITIATED ---");
    addLog("Button clicked, starting Apple OAuth flow");

    setError(null);
    setLoading(true);

    try {
      console.log("🍎 Step 1: Preparing signIn.social call");
      addLog("Step 1: Preparing signIn.social call with provider: 'apple'");

      const callbackURL = "/apple-test";
      console.log("🍎 Callback URL:", callbackURL);
      addLog(`Callback URL: ${callbackURL}`);

      console.log("🍎 Step 2: Calling authClient.signIn.social...");
      addLog("Step 2: Calling authClient.signIn.social...");

      const startTime = Date.now();

      const response = await authClient.signIn.social({
        provider: "apple",
        callbackURL: callbackURL,
      });

      const duration = Date.now() - startTime;
      console.log("🍎 Step 3: signIn.social returned after", duration, "ms");
      console.log("🍎 Full response:", response);
      addLog(`Step 3: signIn.social returned after ${duration}ms`);
      addLog(`Full response: ${JSON.stringify(response, null, 2)}`);

      if (response?.error) {
        console.error("🍎 ❌ Sign-in returned error:", response.error);
        addLog(
          `❌ ERROR: ${response.error.message || JSON.stringify(response.error)}`
        );
        setError(
          response.error.message ??
            "Failed to sign in with Apple. Please try again."
        );
      } else if (response?.data) {
        console.log("🍎 ✅ Sign-in response data:", response.data);
        addLog(`✅ SUCCESS: Response data received`);
        addLog(`Data: ${JSON.stringify(response.data, null, 2)}`);

        if (response.data.redirect) {
          console.log("🍎 Redirect detected:", response.data.url);
          addLog(`Redirect to: ${response.data.url}`);
        }
      } else {
        console.log("🍎 ⚠️ No error but also no data in response");
        addLog("⚠️ Warning: No error but also no data in response");
      }
    } catch (err) {
      console.error("🍎 ❌ Exception caught:", err);
      console.error("🍎 Error type:", err?.constructor?.name);
      console.error(
        "🍎 Error stack:",
        err instanceof Error ? err.stack : "no stack"
      );

      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;

      addLog(`❌ EXCEPTION: ${errorMessage}`);
      if (errorStack) {
        addLog(`Stack trace: ${errorStack}`);
      }

      setError(errorMessage);
    } finally {
      setLoading(false);
      console.log("🍎 Loading state set to false");
      addLog("Loading state cleared");
      addLog("--- END APPLE SIGN-IN ATTEMPT ---");
    }
  };

  const clearLogs = () => {
    setLogs([]);
    console.clear();
    console.log("🍎 Logs cleared");
  };

  return (
    <>
      <CardHeader className="text-center">
        <CardTitle className="text-lg">🍎 Apple Sign-In Test</CardTitle>
        <CardDescription>
          Debug page for testing Sign in with Apple
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleAppleSignIn}
          disabled={loading}
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <>
              <AppleIcon className="h-4 w-4" />
              Test Sign in with Apple
            </>
          )}
        </Button>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="flex-1"
            onClick={checkSession}
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Check Session
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={clearLogs}>
            Clear Logs
          </Button>
        </div>

        {/* Debug Logs Display */}
        <div className="mt-4">
          <p className="text-sm font-medium text-muted-foreground mb-2">
            Debug Logs ({logs.length}):
          </p>
          <div className="bg-muted rounded-md p-3 max-h-64 overflow-y-auto">
            {logs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No logs yet...</p>
            ) : (
              <pre className="text-xs whitespace-pre-wrap break-all font-mono">
                {logs.join("\n")}
              </pre>
            )}
          </div>
        </div>

        <p className="text-xs text-center text-muted-foreground">
          Check browser console for detailed 🍎 prefixed logs
        </p>
      </CardContent>
    </>
  );
}
