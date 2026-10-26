import type { MetadataRoute } from "next";
import { APP_BACKGROUND_COLOR } from "@/lib/appTheme";

/** The installed web app, and the share sheet target it adds where supported. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Teak",
    short_name: "Teak",
    description: "A personal knowledge hub for creative minds",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: APP_BACKGROUND_COLOR.light,
    theme_color: APP_BACKGROUND_COLOR.light,
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    share_target: {
      action: "/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [
          {
            name: "files",
            accept: [
              "image/*",
              "video/*",
              "audio/*",
              "application/pdf",
              "text/*",
              "*/*",
            ],
          },
        ],
      },
    },
  };
}
