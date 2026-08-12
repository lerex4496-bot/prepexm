const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');
const path = require('path');

/**
 * Sign release builds with a real keystore instead of the debug one.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Expo Android template ships this, with a comment admitting it:
 *
 *     release {
 *         // Caution! In production, you need to generate your own keystore
 *         signingConfig signingConfigs.debug
 *     }
 *
 * So `assembleRelease` produces an APK signed with the Android *debug*
 * certificate. It installs fine on a clean phone, which is what makes this
 * dangerous — the problem only appears later.
 *
 * Android identifies an app by package name AND signing key. An update signed
 * with a different key is rejected outright with "App not installed", and the
 * only way through is to uninstall, which erases the app's data. For this app
 * that means every attempt, every response, and the entire mistake notebook.
 *
 * We hit exactly that: the first APK came from EAS with its managed keystore,
 * the next was built locally and debug-signed, and it would not install over
 * the first.
 *
 * WHY A PLUGIN AND NOT AN EDIT TO android/app/build.gradle
 * -------------------------------------------------------
 * `android/` is generated. Every `expo prebuild` rewrites it, so a hand edit
 * survives until the next regeneration and then silently reverts — and the
 * symptom, an APK that will not install over the previous one, shows up on a
 * phone rather than in the build output.
 *
 * WHERE THE PASSWORD LIVES
 * ------------------------
 * gradle.properties, which is generated and gitignored. The keystore itself is
 * gitignored too. Losing it means never being able to update an installed app
 * again, so it is the one file in this project worth backing up somewhere
 * other than this machine.
 */

const KEYSTORE_FILE = 'keystores/studymate-release.jks';
const KEY_ALIAS = 'studymate';

module.exports = function withReleaseSigning(config, opts = {}) {
  const storePassword = opts.storePassword || process.env.STUDYMATE_KEYSTORE_PASSWORD || 'studymate2026';
  const keyPassword = opts.keyPassword || process.env.STUDYMATE_KEY_PASSWORD || storePassword;

  config = withGradleProperties(config, (cfg) => {
    const set = (key, value) => {
      const existing = cfg.modResults.find((i) => i.type === 'property' && i.key === key);
      if (existing) existing.value = value;
      else cfg.modResults.push({ type: 'property', key, value });
    };
    // ABSOLUTE path, with forward slashes.
    //
    // Two things went wrong with the relative form. Gradle resolves file() from
    // the APP MODULE (android/app), so 'keystores/...' sent it looking in
    // android/app/keystores/ and the build failed at validateSigningRelease.
    // And the keystore itself lived under android/, which `expo prebuild`
    // regenerates — it was deleted on the next prebuild, which is exactly the
    // "lose the keystore and you can never update the app again" case. It now
    // lives at apps/mobile/keystores/, outside anything generated.
    const abs = path.join(cfg.modRequest.projectRoot, KEYSTORE_FILE).replace(/\\/g, '/');
    set('STUDYMATE_UPLOAD_STORE_FILE', abs);
    set('STUDYMATE_UPLOAD_KEY_ALIAS', KEY_ALIAS);
    set('STUDYMATE_UPLOAD_STORE_PASSWORD', storePassword);
    set('STUDYMATE_UPLOAD_KEY_PASSWORD', keyPassword);
    return cfg;
  });

  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;

    // Add a `release` signing config beside the template's `debug` one.
    if (!src.includes('STUDYMATE_UPLOAD_STORE_FILE')) {
      src = src.replace(
        /signingConfigs \{\s*\n(\s*)debug \{/,
        (whole, indent) =>
          `signingConfigs {\n${indent}release {\n` +
          `${indent}    storeFile file(STUDYMATE_UPLOAD_STORE_FILE)\n` +
          `${indent}    storePassword STUDYMATE_UPLOAD_STORE_PASSWORD\n` +
          `${indent}    keyAlias STUDYMATE_UPLOAD_KEY_ALIAS\n` +
          `${indent}    keyPassword STUDYMATE_UPLOAD_KEY_PASSWORD\n` +
          // All three schemes, not just the modern one. AGP turns v1 (JAR
          // signing) off when minSdk >= 24 — correct in theory, and
          // occasionally not in practice: some OEM package installers and file
          // managers still consult the v1 manifest when sideloading, and reject
          // the APK with a bare "App not installed" that names no cause.
          // Enabling all three costs a few hundred KB and removes a whole class
          // of that failure.
          `${indent}    enableV1Signing true\n` +
          `${indent}    enableV2Signing true\n` +
          `${indent}    enableV3Signing true\n` +
          `${indent}}\n${indent}debug {`
      );
    }

    // Point the RELEASE build type at it.
    //
    // Anchored to the template's own comment rather than to a `release {`
    // block. The obvious pattern — /(release \{[\s\S]*?)signingConfig
    // signingConfigs\.debug/ — matched the `release` entry this plugin had just
    // inserted into signingConfigs, then took the next `signingConfigs.debug`
    // it found, which belonged to buildTypes.DEBUG. The result compiled and
    // shipped happily with the two swapped: debug builds release-signed, and
    // the release APK still signed with the debug key. Nothing failed; the APK
    // just would not install over the previous one.
    src = src.replace(
      /\/\/ Caution! In production[\s\S]*?signingConfig signingConfigs\.debug/,
      'signingConfig signingConfigs.release'
    );

    cfg.modResults.contents = src;
    return cfg;
  });
};
