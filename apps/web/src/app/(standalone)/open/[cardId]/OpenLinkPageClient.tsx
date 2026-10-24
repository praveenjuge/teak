"use client";

import { useParams } from "next/navigation";
import { OpenLinkScreen } from "@/screens/OpenLinkScreen";

export function OpenLinkPageClient() {
  const { cardId } = useParams<{ cardId: string }>();
  return <OpenLinkScreen cardId={cardId} key={cardId} />;
}
