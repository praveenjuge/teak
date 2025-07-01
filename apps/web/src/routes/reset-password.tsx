import {
  createFileRoute,
  Link,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { AuthLayout } from "@/components/AuthLayout";

export const Route = createFileRoute("/reset-password")({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    token: (search.token as string) || "",
  }),
});

function RouteComponent() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();
  const { token } = useSearch({ from: "/reset-password" });

  useEffect(() => {
    // Check if token is present in URL
    if (!token) {
      setError(
        "Invalid or missing reset token. Please request a new password reset."
      );
    }
  }, [token]);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    // Validate passwords match
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    // Validate password length
    if (password.length < 8) {
      setError("Password must be at least 8 characters long");
      setIsLoading(false);
      return;
    }

    if (!token) {
      setError("Invalid or missing reset token");
      setIsLoading(false);
      return;
    }

    try {
      const { error } = await authClient.resetPassword({
        newPassword: password,
        token,
      });

      if (error) {
        setError(error.message || "Failed to reset password");
        console.log("Password reset error:", error);
        return;
      }

      console.log("Password reset successful");
      setSuccess(true);

      // Redirect to login page after a short delay
      setTimeout(() => {
        navigate({ to: "/login" });
      }, 2000);
    } catch (err) {
      console.error("Password reset error:", err);
      setError("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <AuthLayout>
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">
              Password Reset Successful
            </CardTitle>
            <CardDescription>
              Your password has been reset successfully
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 text-sm text-green-600 bg-green-50 border border-green-200 rounded-md">
              Password reset successfully! Redirecting to login...
            </div>
            <div className="text-center">
              <Link to="/login" className="text-sm hover:underline">
                Go to Sign In
              </Link>
            </div>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Reset Password</CardTitle>
          <CardDescription>Enter your new password</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleResetPassword} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="password">New Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter new password (min 8 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading || !token}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={isLoading || !token}
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || !token}
            >
              {isLoading ? "Resetting..." : "Reset Password"}
            </Button>
          </form>
          <div className="mt-4 text-center">
            <div className="text-sm text-muted-foreground">
              Remember your password?{" "}
              <Link to="/login" className="hover:underline">
                Sign in
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
