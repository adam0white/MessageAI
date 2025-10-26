/**
 * Shim for expo-modules-core NativeJSLogger
 *
 * This module doesn't exist in React Native 0.81.5, but expo-modules-core
 * tries to import it. We provide a compatible shim to prevent crashes.
 */

console.log('🔧 NativeJSLogger shim loaded!');

export default {
  addListener: (eventName: string, handler: (event: any) => void) => {
    console.log('🔧 NativeJSLogger.addListener called:', eventName);
    // Return a subscription object that matches EventEmitter signature
    return {
      remove: () => {
        console.log('🔧 NativeJSLogger subscription removed');
      }
    };
  },
  removeListeners: (count: number) => {
    console.log('🔧 NativeJSLogger.removeListeners called:', count);
  }
};

