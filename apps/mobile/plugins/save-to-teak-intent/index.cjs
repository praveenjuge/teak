"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  IOSConfig,
  withDangerousMod,
  withXcodeProject,
} = require("expo/config-plugins");

const FILE_NAME = "SaveToTeakIntent.swift";

/** Adds the "Save to Teak" App Intent to the app target for Shortcuts and Siri. */
const withSaveToTeakIntent = (config) => {
  const withSource = withDangerousMod(config, [
    "ios",
    (modConfig) => {
      const projectName = IOSConfig.XcodeUtils.getProjectName(
        modConfig.modRequest.projectRoot
      );
      fs.copyFileSync(
        path.join(__dirname, FILE_NAME),
        path.join(
          modConfig.modRequest.platformProjectRoot,
          projectName,
          FILE_NAME
        )
      );
      return modConfig;
    },
  ]);
  return withXcodeProject(withSource, (modConfig) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(
      modConfig.modRequest.projectRoot
    );
    const project = modConfig.modResults;
    const filepath = `${projectName}/${FILE_NAME}`;
    if (!project.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath,
        groupName: projectName,
        project,
      });
    }
    return modConfig;
  });
};

module.exports = withSaveToTeakIntent;
