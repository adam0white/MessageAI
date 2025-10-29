/**
 * Shim for expo-modules-core NativeJSLogger
 *
 * This module doesn't exist in React Native 0.81.5, but expo-modules-core
 * tries to import it. We provide a compatible shim to prevent crashes.
 */

// Module with methods directly exported
const NativeJSLogger = {
  addListener: (eventName: string, handler?: (event: any) => void) => {
    // Return a subscription object that matches EventEmitter signature
    return {
      remove: () => {
        // No-op
      }
    };
  },
  removeListeners: (count: number) => {
    // No-op
  }
};

// Export both as default and named to cover all import scenarios
export default NativeJSLogger;
export { NativeJSLogger };

