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
import { useEffect, useState } from "react";
import { AlertCircle, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import Link from "next/link";
import { Spinner } from "@/components/ui/spinner";

type RegistrationStatus = {
  allowed: boolean;
  message?: string | null;
};

export default function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [registrationStatus, setRegistrationStatus] =
    useState<RegistrationStatus | null>(null);
  const [showSuccessAlert, setShowSuccessAlert] = useState(false);
  const registrationClosed = registrationStatus?.allowed === false;

  useEffect(() => {
    let isMounted = true;
    const loadStatus = async () => {
      try {
        const response = await fetch("/api/auth/registration-status");
        const data = (await response.json()) as RegistrationStatus;
        if (!isMounted) return;
        setRegistrationStatus(data);
      } catch (fetchError) {
        console.warn("Failed to load registration status", fetchError);
        if (!isMounted) return;
        setRegistrationStatus({ allowed: true });
      }
    };

    loadStatus();
    return () => {
      isMounted = false;
    };
  }, []);

  const passwordTooShort = password.length > 0 && password.length < 8;
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
        {showSuccessAlert && (
          <Alert className="mb-4">
            <Mail />
            <AlertDescription>
              Registration successful! Please check your email to verify your
              account.
            </AlertDescription>
          </Alert>
        )}
        {registrationClosed && (
          <Alert className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {registrationStatus?.message ??
                "Registration is currently closed."}
            </AlertDescription>
          </Alert>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);

            if (registrationClosed) {
              setError(
                registrationStatus?.message ??
                  "Registration is currently closed"
              );
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
              name: "",
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
                  const message =
                    ctx.error?.message ?? "Failed to create account";
                  if (ctx.error?.status === 403) {
                    setRegistrationStatus({
                      allowed: false,
                      message,
                    });
                  }
                  setError(message);
                },
                onSuccess: async () => {
                  setLoading(false);
                  setShowSuccessAlert(true);
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

          <Button
            type="submit"
            className="w-full"
            disabled={loading || password.length < 8 || registrationClosed}
          >
            {loading ? <Spinner /> : "Create an account"}
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
