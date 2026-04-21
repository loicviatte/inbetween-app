const { withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const MODULE_DIR = path.join(__dirname, '../modules/audio-route-picker/ios');
const FILES = ['AudioRoutePicker.swift', 'AudioRoutePickerBridge.m'];

function withAudioRoutePicker(config) {
  // Copy Swift + ObjC bridge files into ios/<AppName>/ during prebuild
  config = withDangerousMod(config, [
    'ios',
    (config) => {
      const appName = config.modRequest.projectName;
      const destDir = path.join(config.modRequest.platformProjectRoot, appName);
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of FILES) {
        fs.copyFileSync(path.join(MODULE_DIR, file), path.join(destDir, file));
      }
      return config;
    },
  ]);

  // Add files to the Xcode build target
  config = withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const appName = config.modRequest.projectName;

    // Resolve the PBXGroup for the app (where source files are listed).
    // We must pass this as the 3rd arg to addSourceFile so the xcode package
    // doesn't fall back to a hardcoded UUID that may not exist in this project.
    const groups = xcodeProject.pbxGroupSection();
    const appGroupKey = Object.keys(groups).find((k) => {
      if (k.endsWith('_comment')) return false;
      const g = groups[k];
      const name = g.name || g.path || '';
      return name === `"${appName}"` || name === appName;
    });

    // Resolve the native application target key
    const targets = xcodeProject.pbxNativeTargetSection();
    const targetKey = Object.keys(targets).find(
      (k) =>
        !k.endsWith('_comment') &&
        targets[k].productType === '"com.apple.product-type.application"',
    );

    if (!targetKey || !appGroupKey) return config;

    for (const file of FILES) {
      // Skip if already added (idempotent)
      const buildPhase = xcodeProject.pbxSourcesBuildPhaseObj(targetKey);
      const already = (buildPhase?.files || []).some((f) => {
        const ref = xcodeProject.pbxFileReferenceSection()[f.value];
        return ref && (ref.path === `"${file}"` || ref.path === file);
      });
      if (!already) {
        xcodeProject.addSourceFile(`${appName}/${file}`, { target: targetKey }, appGroupKey);
      }
    }

    return config;
  });

  return config;
}

module.exports = withAudioRoutePicker;
