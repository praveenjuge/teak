import { Button } from "@teak/ui/components/ui/button";
import {
  CardContent,
  CardFooter,
  CardTitle,
} from "@teak/ui/components/ui/card";
import Logo from "@teak/ui/logo";
import { AuthScreenShell } from "@teak/ui/screens";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth-server";
import {
  NATIVE_AUTH_SURFACE_LABELS,
  parseNativeAuthRequest,
} from "@/lib/native-auth-request";
import { buildPublicAppUrl } from "@/lib/public-app-url";

interface NativeAuthStartPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const requestUrlFromHeaders = async (
  pathname: string,
  search: string
): Promise<URL> => {
  const headerStore = await headers();
  const host =
    headerStore.get("x-forwarded-host") ??
    headerStore.get("host") ??
    "app.teakvault.com";
  const protocol = headerStore.get("x-forwarded-proto") ?? "https";
  return new URL(`${pathname}${search}`, `${protocol}://${host}`);
};

export default async function NativeAuthStartPage({
  searchParams,
}: NativeAuthStartPageProps) {
  const params = await searchParams;
  const parsed = parseNativeAuthRequest({
    codeChallenge: params.code_challenge,
    deviceId: params.device_id,
    redirectUri: params.redirect_uri,
    state: params.state,
    surface: params.surface,
  });

  if (!parsed) {
    return (
      <AuthScreenShell
        logo={
          <Link href="/">
            <Logo variant="primary" />
          </Link>
        }
      >
        <CardTitle className="px-6 text-center text-lg">
          Invalid device request
        </CardTitle>
        <CardContent>
          <p className="text-center text-muted-foreground text-sm">
            This sign-in link is incomplete or expired. Return to the Teak app
            and try again.
          </p>
        </CardContent>
      </AuthScreenShell>
    );
  }

  const search = new URLSearchParams({
    code_challenge: parsed.codeChallenge,
    device_id: parsed.deviceId,
    redirect_uri: parsed.redirectUri.toString(),
    state: parsed.state,
    surface: parsed.surface,
  }).toString();
  const requestUrl = await requestUrlFromHeaders(
    "/native/auth/start",
    `?${search}`
  );

  if (!(await isAuthenticated())) {
    const loginUrl = buildPublicAppUrl("/login", requestUrl);
    loginUrl.searchParams.set(
      "next",
      `${requestUrl.pathname}${requestUrl.search}`
    );
    redirect(loginUrl.toString());
  }

  const surfaceLabel = NATIVE_AUTH_SURFACE_LABELS[parsed.surface];

  return (
    <AuthScreenShell
      logo={
        <Link href="/">
          <Logo variant="primary" />
        </Link>
      }
    >
      <CardTitle className="px-6 text-center text-lg">
        Approve this device?
      </CardTitle>
      <CardContent className="space-y-4">
        <p className="text-center text-muted-foreground text-sm">
          {surfaceLabel} is asking to sign in to your Teak account. Approve only
          if you started this sign-in from that app.
        </p>
        <div className="rounded-2xl border p-3">
          <p className="font-medium text-sm">{surfaceLabel}</p>
          <p className="mt-2 break-all text-muted-foreground text-xs">
            Device {parsed.deviceId}
          </p>
        </div>
      </CardContent>
      <CardFooter>
        <form
          action="/native/auth/approve"
          className="grid w-full gap-3"
          method="post"
        >
          <input
            name="code_challenge"
            type="hidden"
            value={parsed.codeChallenge}
          />
          <input name="device_id" type="hidden" value={parsed.deviceId} />
          <input
            name="redirect_uri"
            type="hidden"
            value={parsed.redirectUri.toString()}
          />
          <input name="state" type="hidden" value={parsed.state} />
          <input name="surface" type="hidden" value={parsed.surface} />
          <Button type="submit">Approve device</Button>
          <Button asChild variant="outline">
            <Link href="/">Cancel</Link>
          </Button>
        </form>
      </CardFooter>
    </AuthScreenShell>
  );
}
