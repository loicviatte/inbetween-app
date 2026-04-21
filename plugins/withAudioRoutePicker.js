const { withXcodeProject, withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const MODULE_DIR = path.join(__dirname, '../modules/audio-route-picker/ios');
const FILES = ['AudioRoutePicker.swift', 'AudioRoutePickerBridge.m'];

function withAudioRoutePicker(config) {
  // 1. Copy source files into the ios/<AppName>/ directory during prebuild
  config = withDangerousMod(config, [
    'ios',
    (config) => {
      const appName = config.modRequest.projectName;
      const iosDir = path.join(config.modRequest.platformProjectRoot, appName);
      for (const file of FILES) {
        fs.copyFileSync(path.join(MODULE_DIR, file), path.join(iosDir, file));
      }
      return config;
    },
  ]);

  // 2. Add the copied files to the Xcode build target
  config = withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const appName = config.modRequest.projectName;
    const target = xcodeProject.getFirstTarget().uuid;

    for (const file of FILES) {
      const alreadyAdded = xcodeProject
        .pbxSourcesBuildPhaseObj(target)
        ?.files?.some?.((f) => f.comment?.includes(file));
      if (!alreadyAdded) {
        xcodeProject.addSourceFile(
          `${appName}/${file}`,
          { target },
          xcodeProject.getFirstTarget().firstTarget.buildConfigurationList,
        );
      }
    }

    return config;
  });

  return config;
}

module.exports = withAudioRoutePicker;
