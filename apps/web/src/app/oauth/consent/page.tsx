"use client";

import { api } from "@teak/convex";
import { Button } from "@teak/ui/components/ui/button";
import {
  CardContent,
  CardFooter,
  CardTitle,
} from "@teak/ui/components/ui/card";
import Logo from "@teak/ui/logo";
import { AuthScreenShell } from "@teak/ui/screens";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

const SCOPE_LABELS: Record<string, string> = {
  email: "View your account email",
  offline_access: "Stay connected until you revoke access",
  openid: "Confirm your Teak identity",
  profile: "View your profile",
};

function ConsentContent() {
  const searchParams = useSearchParams();
  const consentCode = searchParams.get("consent_code")?.trim() ?? "";
  const request = useQuery(
    api.oauthTokens.getOAuthConsentRequest,
    consentCode ? { consentCode } : "skip"
  ) as { clientId: string; name: string; scopes: string[] } | null | undefined;
  const [pending, setPending] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (accept: boolean) => {
    if (!(request && consentCode)) {
      setError("This authorization request is incomplete or expired.");
      return;
    }

    setPending(accept ? "approve" : "deny");
    setError(null);
    try {
      const response = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept, consent_code: consentCode }),
      });
      const body = (await response.json()) as {
        message?: string;
        redirectURI?: string;
      };
      if (!(response.ok && body.redirectURI)) {
        throw new Error(body.message ?? "The authorization request failed.");
      }
      window.location.replace(body.redirectURI);
    } catch (requestError) {
      setPending(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The authorization request failed."
      );
    }
  };

  if (request === undefined) {
    return (
      <AuthScreenShell
        logo={
          <Link href="/">
            <Logo variant="primary" />
          </Link>
        }
      >
        <CardContent className="flex min-h-48 items-center justify-center">
          <Loader2 className="animate-spin" />
        </CardContent>
      </AuthScreenShell>
    );
  }

  return (
    <AuthScreenShell
      logo={
        <Link href="/">
          <Logo variant="primary" />
        </Link>
      }
    >
      <CardTitle className="px-6 text-center text-lg">
        Allow this app to access Teak?
      </CardTitle>
      <CardContent className="space-y-4">
        <p className="text-center text-muted-foreground text-sm">
          An external app is requesting full access to your Teak vault. It can
          read, create, edit, and delete your cards and access their files. Only
          continue if you started this connection.
        </p>
        <div className="rounded-md border p-3">
          <p className="font-medium text-sm">Requested access</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground text-sm">
            {request?.scopes.map((scope) => (
              <li key={scope}>{SCOPE_LABELS[scope] ?? scope}</li>
            ))}
          </ul>
          <p className="mt-3 break-all text-muted-foreground text-xs">
            {request
              ? `${request.name} · ${request.clientId}`
              : "Invalid request"}
          </p>
        </div>
        {error ? (
          <p className="text-center text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="grid grid-cols-2 gap-3">
        <Button
          disabled={pending !== null}
          onClick={() => void decide(false)}
          variant="outline"
        >
          {pending === "deny" ? <Loader2 className="animate-spin" /> : "Deny"}
        </Button>
        <Button disabled={pending !== null} onClick={() => void decide(true)}>
          {pending === "approve" ? (
            <Loader2 className="animate-spin" />
          ) : (
            "Allow"
          )}
        </Button>
      </CardFooter>
    </AuthScreenShell>
  );
}

export default function OAuthConsentPage() {
  return (
    <Suspense>
      <ConsentContent />
    </Suspense>
  );
}
