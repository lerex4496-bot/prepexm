const fs = require('fs');
const path = require('path');

/**
 * Dynamic Expo config.
 *
 * WHY THIS FILE EXISTS ALONGSIDE app.json
 * ---------------------------------------
 * Expo reads app.json for static configuration, and this file for anything that
 * has to be computed at build time. Everything structural stays in app.json;
 * this only adds the model credentials.
 *
 * The credentials are read from apps/api/.env — which is gitignored — rather
 * than written into app.json, which is committed. Pasting a live key into a
 * tracked file is how keys reach a public repository, and a key in git history
 * cannot be un-published: rotation is the only remedy. Keeping the values in
 * one gitignored place means there is exactly one file to protect.
 *
 * WHAT THIS DOES NOT PROTECT AGAINST
 * ----------------------------------
 * Bundling a key into a client is not a way of keeping it secret. Whatever is
 * read here is embedded in the APK, and an APK is a zip — anyone who can
 * install the app can extract every string in it. This was raised and chosen
 * deliberately for a build shared privately with two students. If that APK ever
 * circulates more widely, rotate both keys; there is no better fix, because
 * there is no safe place for a secret inside a client binary.
 */

function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#') || !s.includes('=')) continue;
    const i = s.indexOf('=');
    out[s.slice(0, i).trim()] = s
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return out;
}

module.exports = ({ config }) => {
  // The API service's own .env is the single source of truth for these, so the
  // phone build and the server never drift onto different keys.
  const env = {
    ...readEnv(path.join(__dirname, '..', 'api', '.env')),
    ...process.env, // a real environment variable wins, for CI
  };

  const keys = {
    sarvamKey: env.SARVAM_API_KEY || '',
    sarvamModel: env.SARVAM_MODEL || 'sarvam-105b-conversations',
    nvidiaKey: env.NVIDIA_API_KEY || '',
    nvidiaReasonModel: env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b',
  };

  // Loud, because the failure is silent otherwise: the app builds fine and the
  // tutor simply reports itself unavailable on the phone, which looks like a
  // network problem rather than a missing build input.
  if (!keys.sarvamKey && !keys.nvidiaKey) {
    console.warn(
      '[studymate] No model keys found in apps/api/.env — the tutor and ' +
        'explanations will be unavailable in this build.'
    );
  }

  return {
    ...config,
    extra: { ...(config.extra ?? {}), ...keys },
  };
};
