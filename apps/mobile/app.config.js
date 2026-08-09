const rootPackage = require("../../package.json");
const iosBuildNumber = process.env.TEAK_IOS_BUILD_NUMBER;

if (iosBuildNumber && !/^[1-9]\d*$/.test(iosBuildNumber)) {
  throw new Error("TEAK_IOS_BUILD_NUMBER must be a positive integer.");
}

module.exports = ({ config }) => ({
  ...config,
  version: rootPackage.version,
  ios: {
    ...config.ios,
    ...(iosBuildNumber ? { buildNumber: iosBuildNumber } : {}),
  },
  extra: {
    ...config.extra,
  },
});
