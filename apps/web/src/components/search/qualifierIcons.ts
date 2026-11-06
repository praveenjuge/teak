import {
  Aperture,
  Banknote,
  Folder,
  Globe,
  ListFilter,
  ScanText,
  Sparkles,
  Star,
  Tag,
} from "vadivam-react";

/** The icon a search qualifier's chip or suggestion shows: `tag:`, `site:`… */
export const QUALIFIER_ICONS = {
  tag: Tag,
  site: Globe,
  folder: Folder,
  type: ListFilter,
  is: Star,
  like: Sparkles,
  mood: Aperture,
  price: Banknote,
  text: ScanText,
} as const;
