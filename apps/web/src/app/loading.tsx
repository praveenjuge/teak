import { AppLoading } from "@/components/app-shell/AppLoading";

export default function Loading({
  fullscreen = true,
}: {
  fullscreen?: boolean;
}) {
  return <AppLoading fullscreen={fullscreen} />;
}
