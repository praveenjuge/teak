import { toast } from "sonner";

export async function copyColorHexToClipboard(hex: string) {
  try {
    await navigator.clipboard.writeText(hex);
    toast.success(`Copied ${hex}`);
  } catch (error) {
    console.error("Failed to copy color", error);
    toast.error("Failed to copy");
  }
}
