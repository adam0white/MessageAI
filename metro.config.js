// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Add support for WASM files (needed for expo-sqlite on web)
config.resolver.assetExts.push('wasm');

// Enable web support
config.resolver.sourceExts = [...config.resolver.sourceExts, 'web.js', 'web.ts', 'web.tsx'];

// Shim for missing expo-modules-core NativeJSLogger (not available in RN 0.81.5)
config.resolver.alias = {
  'expo-modules-core/src/sweet/NativeJSLogger': path.resolve(__dirname, 'shims/NativeJSLogger.ts'),
  'NativeJSLogger': path.resolve(__dirname, 'shims/NativeJSLogger.ts'),
};

// Debug: Log when Metro config loads
console.log('🔧 Metro config loaded, NativeJSLogger shim:', path.resolve(__dirname, 'shims/NativeJSLogger.ts'));

module.exports = config;

