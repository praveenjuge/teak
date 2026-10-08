import Logo from "@teak/ui/logo";
import { AuthScreenShell } from "@teak/ui/screens";

// Desktop sign-in needs WorkOS before this app ships. Until then, the signed-out
// screen explains where to use Teak instead of offering a button that can't work.
export function LoginPage() {
  return (
    <AuthScreenShell logo={<Logo variant="primary" />}>
      <div className="flex flex-col gap-2 px-6 text-center text-sm">
        <p className="font-medium">
          Sign-in isn't available in this build yet.
        </p>
        <p className="text-muted-foreground">
          Use the Teak Mac app or teakvault.com for now.
        </p>
      </div>
    </AuthScreenShell>
  );
}
