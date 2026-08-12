const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Remove permissions this app does not use.
 *
 * WHY THEY ARE THERE AT ALL
 * -------------------------
 * Expo's bare Android template ships a block of permissions with its own
 * comment attached — "OPTIONAL PERMISSIONS, REMOVE WHATEVER YOU DO NOT NEED"
 * (@expo/config-plugins/build/plugins/withAndroidBaseMods.js). Nobody removed
 * them, so a build that never draws over other apps still asks for
 * SYSTEM_ALERT_WINDOW.
 *
 * WHY IT MATTERS MORE THAN TIDINESS
 * ---------------------------------
 * SYSTEM_ALERT_WINDOW is "draw on top of other apps" — the permission overlay
 * -attack malware needs, and one Play Protect weighs heavily when scanning a
 * sideloaded APK. A Protect refusal surfaces on the phone as "App not
 * installed", with no reason given and nothing in the logs the student can see.
 *
 * That is not proof it caused ours. It is a permission the app never uses,
 * sitting on the exact failure path we are debugging, and removing it costs
 * nothing.
 *
 * RECORD_AUDIO comes from somewhere else: the expo-image-picker config plugin
 * adds it unless `microphonePermission: false` is passed. That is set in
 * app.json, so this plugin only has to sweep up anything that slips through —
 * a library added later could reintroduce it without anyone noticing.
 *
 * WHAT IS DELIBERATELY KEPT
 * -------------------------
 * CAMERA, INTERNET, ACCESS_NETWORK_STATE, VIBRATE and the two storage
 * permissions. Photographing a question and uploading a PDF are features she
 * has; taking those away to look tidy would break them.
 */

const REMOVE = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.RECORD_AUDIO',
];

module.exports = function withPermissionTrim(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const before = manifest['uses-permission']?.length ?? 0;

    manifest['uses-permission'] = (manifest['uses-permission'] ?? []).filter((p) => {
      const name = p.$?.['android:name'];
      if (!REMOVE.includes(name)) return true;
      // KEEP an entry that carries tools:node="remove". That is not the
      // permission being requested — it is a manifest-merger directive that
      // strips it, including copies contributed by libraries. Deleting the
      // directive would let those libraries put the permission back, which is
      // the opposite of what this plugin is for.
      //
      // expo-image-picker writes exactly this for RECORD_AUDIO once
      // `microphonePermission: false` is set in app.json.
      return p.$?.['tools:node'] === 'remove';
    });

    // Also strip the SDK-23 variant, which merges in from some libraries as a
    // separate element and would otherwise survive the filter above.
    if (manifest['uses-permission-sdk-23']) {
      manifest['uses-permission-sdk-23'] = manifest['uses-permission-sdk-23'].filter(
        (p) => !REMOVE.includes(p.$?.['android:name'])
      );
    }

    const after = manifest['uses-permission'].length;
    if (before !== after) {
      console.log(`[studymate] removed ${before - after} unused permission(s)`);
    }
    return cfg;
  });
};
