/** @type {import('@bacons/apple-targets/app.plugin').Config} */
//
// IMPORTANT: iOS refuses to launch an app whose extension's CFBundleVersion
// doesn't match the parent app's. EAS `autoIncrement: true` only bumps the
// main app — the extension keeps its own value and drifts. We pin the
// extension build number here to the value EAS will produce on the next
// build so they line up at install time.
//
// On each new release: bump `buildNumber` here to (current EAS counter + 1)
// before triggering `eas build`.
//
module.exports = {
  type: "widget",
  name: "InBetweenLiveActivities",
  bundleIdentifier: ".InBetweenLiveActivities",
  deploymentTarget: "16.2",
  frameworks: ["SwiftUI", "WidgetKit", "ActivityKit"],
  version: "1.6.3",
  buildNumber: "64",
};
