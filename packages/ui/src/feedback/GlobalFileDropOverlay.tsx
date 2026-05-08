import { Upload } from "lucide-react";

interface GlobalFileDropOverlayProps {
  isDragActive: boolean;
}

/**
 * Subtle drag-active affordance mounted once per authenticated surface.
 *
 * Renders a thin outline around the viewport plus a compact top-center bar
 * while a file drag is over the app. Pointer events stay disabled so the
 * overlay never eats the drop event — the provider captures that on
 * `document`.
 */
export function GlobalFileDropOverlay({
  isDragActive,
}: GlobalFileDropOverlayProps) {
  if (!isDragActive) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50"
      data-testid="global-file-drop-overlay"
    >
      <div className="absolute inset-2 rounded-md border-2 border-primary/60 border-dashed" />
      <div className="absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-primary px-4 py-1.5 text-primary-foreground text-xs shadow-sm">
        <Upload className="size-3.5" />
        <span className="font-medium">Drop files to upload</span>
      </div>
    </div>
  );
}
