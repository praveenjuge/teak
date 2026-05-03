import type { Configuration } from "electron-builder";

const config: Configuration = {
  appId: "com.praveenjuge.teak.desktop",
  productName: "Teak",
  copyright: "Copyright © Praveen Juge",

  directories: {
    output: "release",
    buildResources: "build",
  },

  files: ["out/**/*"],

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
    identity: null,
    icon: "build/icon.icns",
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
