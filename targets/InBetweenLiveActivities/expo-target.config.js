/** @type {import('@bacons/apple-targets/app.plugin').Config} */
//
// The extension's version and build number are not set here: they're copied
// from the app at build time (plugins/withWidgetVersionMatchesApp.js), since
// EAS only knows the real build number after prebuild has run.
//
module.exports = {
  type: "widget",
  name: "InBetweenLiveActivities",
  bundleIdentifier: ".InBetweenLiveActivities",
  deploymentTarget: "16.2",
  frameworks: ["SwiftUI", "WidgetKit", "ActivityKit"],
};
