"use client";

import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useState } from "react";
import { Loader2, X, AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import Link from "next/link";

export default function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmPasswordTouched, setConfirmPasswordTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);

  // Check if passwords match for real-time validation
  const passwordsMatch = password === passwordConfirmation;
  const passwordTooShort = password.length > 0 && password.length < 8;
  const showPasswordMismatch =
    confirmPasswordTouched && passwordConfirmation && !passwordsMatch;
  const showPasswordTooShort =
    passwordTouched && password.length > 0 && password.length < 8;

  return (
    <>
      <CardHeader className="text-center">
        <CardTitle className="text-lg">Sign Up</CardTitle>
        <CardDescription>
          Enter your information to create an account
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);

            // Validate passwords match
            if (password !== passwordConfirmation) {
              setError("Passwords do not match");
              return;
            }

            // Validate password length
            if (password.length < 8) {
              setError("Password must be at least 8 characters long");
              return;
            }

            await authClient.signUp.email({
              email,
              password,
              name: email,
              callbackURL: "/",
              fetchOptions: {
                onResponse: () => {
                  setLoading(false);
                },
                onRequest: () => {
                  setLoading(true);
                },
                onError: (ctx) => {
                  setLoading(false);
                  setError(ctx.error?.message ?? "Failed to create account");
                },
                onSuccess: async () => {
                  setLoading(false);
                  router.push("/");
                },
              },
            });
          }}
          className="grid gap-4"
        >
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="me@example.com"
              required
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              value={email}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setPasswordTouched(true)}
              autoComplete="new-password"
              placeholder="Password"
              required
              className={showPasswordTooShort ? "border-destructive" : ""}
            />
            {showPasswordTooShort && (
              <p className="text-sm text-destructive">
                Password must be at least 8 characters long
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password_confirmation">Confirm Password</Label>
            <Input
              id="password_confirmation"
              type="password"
              value={passwordConfirmation}
              onChange={(e) => setPasswordConfirmation(e.target.value)}
              onBlur={() => setConfirmPasswordTouched(true)}
              autoComplete="new-password"
              placeholder="Confirm Password"
              required
              className={showPasswordMismatch ? "border-destructive" : ""}
            />
            {showPasswordMismatch && (
              <p className="text-sm text-destructive">Passwords do not match</p>
            )}
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={loading || !passwordsMatch || password.length < 8}
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              "Create an account"
            )}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="text-center text-primary justify-center">
        {/* @ts-ignore */}
        <Link href="/login">Already have an account? Login</Link>
      </CardFooter>
    </>
  );
}
