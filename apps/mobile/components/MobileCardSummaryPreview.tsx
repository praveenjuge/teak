import { ContentUnavailableView } from "@expo/ui/swift-ui";
import type { MobileCardSummary } from "@/lib/mobile-card-summary-cache";

const iconByType = {
  audio: "music.note",
  document: "paperclip",
  image: "photo",
  link: "link",
  palette: "paintpalette",
  quote: "text.quote",
  text: "textformat",
  video: "play.rectangle",
} as const;

export function MobileCardSummaryPreview({
  summary,
}: {
  summary: MobileCardSummary;
}) {
  return (
    <ContentUnavailableView
      description={summary.previewText}
      systemImage={iconByType[summary.type]}
      title={summary.title}
    />
  );
}
