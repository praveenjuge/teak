import { loader } from "fumadocs-core/source";
import { docs } from "@/.source";
import {
  BookOpen,
  Code,
  Sparkles,
  Settings,
  Shield,
  FileText,
  HelpCircle,
} from "lucide-react";

const iconMap = {
  BookOpen,
  Code,
  Sparkles,
  Settings,
  Shield,
  FileText,
  HelpCircle,
};

// See https://fumadocs.vercel.app/docs/headless/source-api for more info
export const source = loader({
  // it assigns a URL to your pages
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  icon: (iconName) => {
    const Icon = iconMap[iconName as keyof typeof iconMap];
    if (Icon) {
      return <Icon className="size-4" />;
    }
    return null;
  },
});
