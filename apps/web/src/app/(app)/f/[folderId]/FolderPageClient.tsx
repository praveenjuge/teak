"use client";

import { useParams } from "next/navigation";
import { decodeFolderSegment } from "@/lib/folders";
import { HomePageClient } from "../../../HomePageClient";

export function FolderPageClient() {
  const params = useParams<{ folderId: string }>();
  const folderId = decodeFolderSegment(params.folderId);
  return <HomePageClient folderId={folderId} key={folderId} />;
}
