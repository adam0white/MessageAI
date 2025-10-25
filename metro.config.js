// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add support for WASM files (needed for expo-sqlite on web)
config.resolver.assetExts.push('wasm');

// Enable web support
config.resolver.sourceExts = [...config.resolver.sourceExts, 'web.js', 'web.ts', 'web.tsx'];

module.exports = config;

