import { AppLoading } from "@/components/AppLoading";

export default function Loading({
  fullscreen = true,
}: {
  fullscreen?: boolean;
}) {
  return <AppLoading fullscreen={fullscreen} />;
}
