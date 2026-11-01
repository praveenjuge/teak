import { api } from "@teak/convex";
import type { ComponentProps } from "react";
import { LinkPreview } from "@/components/card-previews";
import { useQuery } from "@/lib/convexQueryHooks";

export function CheckedLinkPreview(
  props: Omit<ComponentProps<typeof LinkPreview>, "linkState">
) {
  const linkState = useQuery(api.card.linkCheck.getLinkCheck, {
    cardId: props.card._id,
  });
  return <LinkPreview {...props} linkState={linkState} />;
}
