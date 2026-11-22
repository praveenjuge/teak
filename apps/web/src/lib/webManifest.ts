import { APP_BACKGROUND_COLOR } from "./appTheme";
import {
  SHARE_ACTION_PATH,
  SHARE_FILES_FIELD,
  SHARE_TEXT_FIELDS,
  type ShareTextField,
} from "./share/sharedContent";

const shareTextParams = Object.fromEntries(
  SHARE_TEXT_FIELDS.map((field) => [field, field])
) as Record<ShareTextField, ShareTextField>;

// The PWA manifest, served at /manifest.webmanifest.
export function webManifest() {
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
      action: SHARE_ACTION_PATH,
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        ...shareTextParams,
        files: [
          {
            name: SHARE_FILES_FIELD,
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
