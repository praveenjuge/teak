"use client";

import { decodeFolderSegment } from "@teak/ui/lib/folders";
import { useParams } from "next/navigation";
import { HomePageClient } from "../../../HomePageClient";

export function FolderPageClient() {
  const params = useParams<{ folderId: string }>();
  const folderId = decodeFolderSegment(params.folderId);
  return <HomePageClient folderId={folderId} key={folderId} />;
}
