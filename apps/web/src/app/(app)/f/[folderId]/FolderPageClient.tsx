"use client";

import { decodeFolderSegment } from "@teak/ui/lib/folders";
import { useParams } from "next/navigation";
import { HomePageClient } from "../../../HomePageClient";

/** A folder's cards. Each folder gets a fresh screen, so no search carries over. */
export function FolderPageClient() {
  const params = useParams<{ folderId: string }>();
  const folderId = decodeFolderSegment(params.folderId ?? "");
  return <HomePageClient folderId={folderId} key={folderId} />;
}
