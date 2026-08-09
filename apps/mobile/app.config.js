const rootPackage = require("../../package.json");

module.exports = ({ config }) => ({
  ...config,
  version: rootPackage.version,
  extra: {
    ...config.extra,
  },
});
