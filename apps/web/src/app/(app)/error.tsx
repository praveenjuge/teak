"use client";

import { SegmentErrorScreen } from "@/components/feedback/SegmentErrorScreen";

export default function AppError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return <SegmentErrorScreen boundary="app" error={error} />;
}
