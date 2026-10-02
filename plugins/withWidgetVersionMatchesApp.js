// The Live Activities extension must carry the app's own version and build
// number. App Store Connect flags a mismatch on every upload ("The
// CFBundleVersion of an app extension ('1') must match that of its containing
// parent app ('83')") and iOS is entitled to refuse such an extension.
//
// Why it drifts: with EAS's remote version source, prebuild runs on app.json's
// `ios.buildNumber` ("1") — which @bacons/apple-targets copies onto the widget
// target — and EAS writes the real build number (83, 84…) into the APP's
// Info.plist only, afterwards. So the widget target gets a build phase that, at
// build time, copies the app's CFBundleVersion and CFBundleShortVersionString
// into the extension's processed Info.plist, before it is signed.
//
// Ordering: this has to edit the target @bacons/apple-targets creates, through
// the same `xcodeProjectBeta2` mod. Mods of one kind run from the last plugin
// registered to the first, and the provider (registered by apple-targets) must
// come last — so this plugin is listed BEFORE "@bacons/apple-targets" in
// app.json, and therefore runs right after it.

const { withMod } = require('expo/config-plugins');
const { PBXNativeTarget, PBXShellScriptBuildPhase } = require('@bacons/xcode');

const TARGET = 'InBetweenLiveActivities';
const PHASE = 'Match the app version';

const SCRIPT = [
  'APP_PLIST="${SRCROOT}/${PROJECT_NAME}/Info.plist"',
  'EXT_PLIST="${TARGET_BUILD_DIR}/${INFOPLIST_PATH}"',
  'BUILD=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$APP_PLIST" 2>/dev/null)',
  'SHORT=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP_PLIST" 2>/dev/null)',
  "case \"$BUILD\" in ''|*'$('*) BUILD=\"${CURRENT_PROJECT_VERSION}\" ;; esac",
  "case \"$SHORT\" in ''|*'$('*) SHORT=\"${MARKETING_VERSION}\" ;; esac",
  '/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD" "$EXT_PLIST"',
  '/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $SHORT" "$EXT_PLIST"',
  'echo "Live Activities extension: $SHORT ($BUILD)"',
  '',
].join('\n');

module.exports = function withWidgetVersionMatchesApp(config) {
  return withMod(config, {
    platform: 'ios',
    mod: 'xcodeProjectBeta2',
    action: (config) => {
      const project = config.modResults;
      const target = project.rootObject.props.targets.find(
        (t) => PBXNativeTarget.is(t) && t.props.name === TARGET,
      );
      if (!target) {
        throw new Error(`[withWidgetVersionMatchesApp] no "${TARGET}" target — is the plugin listed before @bacons/apple-targets?`);
      }
      // The script reads the app's Info.plist and writes the extension's.
      target.setBuildSetting('ENABLE_USER_SCRIPT_SANDBOXING', 'NO');
      const props = {
        name: PHASE,
        shellPath: '/bin/sh',
        shellScript: SCRIPT,
        // After the extension's Info.plist is processed; on every build.
        inputPaths: ['$(SRCROOT)/$(PROJECT_NAME)/Info.plist', '$(TARGET_BUILD_DIR)/$(INFOPLIST_PATH)'],
        outputPaths: [],
        alwaysOutOfDate: 1,
        showEnvVarsInLog: 0,
      };
      const existing = target.props.buildPhases.find(
        (p) => PBXShellScriptBuildPhase.is(p) && p.props.name === PHASE,
      );
      if (existing) Object.assign(existing.props, props);
      else target.createBuildPhase(PBXShellScriptBuildPhase, props);
      return config;
    },
  });
};
