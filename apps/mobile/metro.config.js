// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('@expo/metro-config');

const config = getDefaultConfig(__dirname);

// The approved-content SQLite bundle ships as an asset. Metro's default
// assetExts does NOT include `db`, so without this the require() in
// src/db/content.ts resolves to nothing, the bundle still builds cleanly, and
// the app installs with an empty question bank — a failure that is invisible
// until someone opens the Practice tab on a real device.
config.resolver.assetExts.push('db');

// Keep Metro out of the source corpus.
//
// `content/` holds ~987 MB of CTET booklets and NCERT textbooks two levels
// above this directory. Metro crawls from the workspace root, so it walks all
// of it on every bundle — slow locally, and on a build worker with less memory
// a plausible way to exhaust resources outright. Nothing in there is imported:
// the app reads one .db asset.
//
// Written as one RegExp rather than via metro-config's `exclusionList` helper,
// which this Metro version no longer exports from that subpath — requiring it
// throws ERR_PACKAGE_PATH_NOT_EXPORTED and takes the whole config down.
// Matches the corpus SUBDIRECTORIES by name, not a bare `content` segment.
// The obvious /[\/]content[\/]/ also matched
// apps/mobile/assets/content/studymate.db — the entire question bank —
// which would have shipped an app with no questions in it. That is the
// same silent-empty-bundle failure the assetExts note above describes,
// arrived at from the opposite direction.
config.resolver.blockList =
  /[\/]content[\/](raw|parsed|manifests|_inbox)[\/]|[\/]dist[\/]|[\/]apps[\/]api[\/]/;

module.exports = config;
