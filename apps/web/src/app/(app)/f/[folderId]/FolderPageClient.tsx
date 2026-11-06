"use client";

import { useParams } from "next/navigation";
import { decodeFolderSegment } from "@/lib/folders";
import { LibraryScreen } from "@/screens/LibraryScreen";

export function FolderPageClient() {
  const params = useParams<{ folderId: string }>();
  const folderId = decodeFolderSegment(params.folderId);
  return <LibraryScreen folderId={folderId} key={folderId} />;
}
