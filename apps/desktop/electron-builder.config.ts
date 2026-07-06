import type { Configuration } from "electron-builder";

const config: Configuration = {
  appId: "com.praveenjuge.teak.desktop",
  productName: "Teak",
  copyright: "Copyright © Praveen Juge",

  directories: {
    output: "release",
    buildResources: "build",
  },

  forceCodeSigning: true,

  files: [".vite/**/*", "package.json"],

  mac: {
    target: [
      {
        target: "dmg",
        arch: ["arm64"],
      },
      {
        target: "zip",
        arch: ["arm64"],
      },
    ],
    category: "public.app-category.productivity",
    minimumSystemVersion: "13.0",
    hardenedRuntime: true,
    // macOS shows this string in the microphone permission prompt. Without
    // NSMicrophoneUsageDescription, the OS terminates the app when it tries
    // to record audio, so audio recording silently fails.
    extendInfo: {
      NSMicrophoneUsageDescription:
        "Teak needs microphone access to record audio notes.",
    },
    identity: "Juge Praveen (LW385M78LW)",
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.inherit.plist",
    icon: "build/icon.icns",
    notarize: true,
  },

  dmg: {
    sign: false,
  },

  publish: {
    provider: "github",
    owner: "praveenjuge",
    repo: "teak",
    releaseType: "release",
  },
};

export default config;
