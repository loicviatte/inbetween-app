const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Xcode 27 refuses to build any target whose IPHONEOS_DEPLOYMENT_TARGET is
// below 15.0. Several pods still pin their own targets far lower (SDWebImage at
// 9.0, ReachabilitySwift and RNCAsyncStorage's resource bundles at 12–13), so
// the whole workspace fails before compiling a line. Raise every pod target to
// the app's own floor — Expo SDK 54 already requires iOS 15.1, so nothing that
// ran before stops running. Harmless on Xcode 26, which CI still uses.
const FLOOR = '15.1';
const MARKER = '# withPodsDeploymentTarget';

module.exports = function withPodsDeploymentTarget(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfile = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let src = fs.readFileSync(podfile, 'utf8');
      if (src.includes(MARKER)) return config;
      const hook = `
    ${MARKER}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |bc|
        current = bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if current.nil? || Gem::Version.new(current) < Gem::Version.new('${FLOOR}')
          bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${FLOOR}'
        end
      end
    end
`;
      const anchor = /post_install do \|installer\|\n/;
      if (!anchor.test(src)) throw new Error('withPodsDeploymentTarget: post_install hook not found in Podfile');
      src = src.replace(anchor, (m) => m + hook);
      fs.writeFileSync(podfile, src);
      return config;
    },
  ]);
};
