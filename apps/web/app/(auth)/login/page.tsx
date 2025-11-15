"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Unauthenticated, AuthLoading, useConvexAuth } from "convex/react";
import Loading from "@/app/loading";

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <>
      <AuthLoading>
        <Loading />
      </AuthLoading>
      <Unauthenticated>
        <CardHeader className="text-center">
          <CardTitle className="text-lg">Sign in to Teak</CardTitle>
          <CardDescription>
            Welcome back! Please sign in to continue
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
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
                placeholder="Password"
                autoComplete="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={loading}
              onClick={async () => {
                await authClient.signIn.email(
                  {
                    email,
                    password,
                  },
                  {
                    onRequest: (ctx) => {
                      setLoading(true);
                    },
                    onResponse: (ctx) => {
                      setLoading(false);
                    },
                    onSuccess: (ctx) => {
                      setLoading(false);
                      router.push("/");
                    },
                  }
                );
              }}
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <p> Login </p>
              )}
            </Button>
          </div>
        </CardContent>
        <CardFooter className="flex-col gap-2 text-primary text-center">
          <Link
            //@ts-ignore
            href="/forgot-password"
          >
            Forgot your password?
          </Link>
          <Link
            //@ts-ignore
            href="/register"
          >
            Don't have an account? Sign Up
          </Link>
        </CardFooter>
      </Unauthenticated>
    </>
  );
}
