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
