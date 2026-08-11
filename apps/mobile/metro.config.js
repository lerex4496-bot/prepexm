// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The approved-content SQLite bundle ships as an asset. Metro's default
// assetExts does NOT include `db`, so without this the require() in
// src/db/content.ts resolves to nothing, the bundle still builds cleanly, and
// the app installs with an empty question bank — a failure that is invisible
// until someone opens the Practice tab on a real device.
config.resolver.assetExts.push('db');

module.exports = config;
