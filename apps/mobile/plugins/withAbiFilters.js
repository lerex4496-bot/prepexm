const { withGradleProperties } = require('expo/config-plugins');

/**
 * Restrict which native ABIs are built into the Android app.
 *
 * WHY THIS PLUGIN EXISTS
 * ----------------------
 * A default Expo Android build ships four ABIs. Measured on our first APK:
 *
 *     x86           23.8 MB   emulator only
 *     x86_64        23.2 MB   emulator only
 *     arm64-v8a     22.6 MB   every phone from ~2016 onward
 *     armeabi-v7a   15.6 MB   older 32-bit phones
 *
 * 47 MB — 42% of a 112 MB APK — is x86 code no physical Android device can
 * execute. Two students on mobile data should not download it.
 *
 * WHY THE OBVIOUS APPROACH FAILS
 * ------------------------------
 * The first attempt injected `defaultConfig { ndk { abiFilters ... } }` into
 * app/build.gradle. It built cleanly and changed nothing: React Native does not
 * read abiFilters to decide what to compile — it reads the
 * `reactNativeArchitectures` gradle property. Setting that is the mechanism
 * that actually works, and it is why this plugin edits gradle.properties
 * rather than build.gradle.
 *
 * `expo-build-properties` cannot do this; it covers minification, resource
 * shrinking and PNG crunching only.
 *
 * armeabi-v7a is kept deliberately. Dropping it would save a further ~15 MB but
 * would silently fail to install on an older 32-bit handset, and we do not know
 * what hardware these two students use. Correctness over the last megabyte.
 */
/**
 * The emulator is x86_64 and no physical phone is, so a release APK built for
 * phones CANNOT run on it — it dies at startup with
 *
 *     couldn't find DSO to load: libreactnative.so
 *
 * before a line of our JavaScript executes. That makes the emulator useless for
 * verifying a device bug unless x86_64 is built in deliberately.
 *
 * Set STUDYMATE_EMULATOR_ABI=1 to include it for a test build. It is an opt-in
 * environment flag rather than a permanent entry because those 23 MB are dead
 * weight in anything the students install.
 */
const ARCHITECTURES = process.env.STUDYMATE_EMULATOR_ABI
  ? 'armeabi-v7a,arm64-v8a,x86_64'
  : 'armeabi-v7a,arm64-v8a';

module.exports = function withAbiFilters(config) {
  return withGradleProperties(config, (cfg) => {
    const key = 'reactNativeArchitectures';
    const existing = cfg.modResults.find(
      (item) => item.type === 'property' && item.key === key
    );

    if (existing) {
      existing.value = ARCHITECTURES;
    } else {
      cfg.modResults.push({
        type: 'comment',
        value: 'Phone ABIs only — x86/x86_64 are emulator-only and were 42% of the APK.',
      });
      cfg.modResults.push({ type: 'property', key, value: ARCHITECTURES });
    }

    return cfg;
  });
};
