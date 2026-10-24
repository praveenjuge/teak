import { type CardType, getCardTypeIcon } from "@teak/convex/shared/constants";
import {
  File,
  FileText,
  Image,
  Link,
  Palette,
  Quote,
  Video,
  Volume2,
} from "vadivam-react";

const iconComponentMap = {
  FileText,
  Link,
  Image,
  Video,
  Volume2,
  File,
  Palette,
  Quote,
} as const;

export const getCardTypeIconComponent = (cardType?: CardType) => {
  if (!cardType) {
    return FileText;
  }
  const iconName = getCardTypeIcon(cardType) as keyof typeof iconComponentMap;
  return iconComponentMap[iconName] ?? FileText;
};
