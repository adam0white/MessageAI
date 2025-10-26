/**
 * App Entry Point
 * 
 * Note: NativeJSLogger shim is handled by Metro config (see metro.config.js)
 * This fixes expo-modules-core compatibility with RN 0.81.5
 */

import { Platform } from 'react-native';

// Silence Android RealtimeKit foreground service warnings (non-critical)
if (Platform.OS === 'android') {
	const originalWarn = console.warn;
	const originalError = console.error;
	
	console.warn = (...args) => {
		const message = args[0]?.toString() || '';
		if (message.includes('RTKForegroundService') || 
		    message.includes('ForegroundServiceDidNotStopInTimeException')) {
			return;
		}
		originalWarn(...args);
	};
	
	console.error = (...args) => {
		const message = args[0]?.toString() || '';
		if (message.includes('RTKForegroundService') || 
		    message.includes('ForegroundServiceDidNotStopInTimeException')) {
			return;
		}
		originalError(...args);
	};
}

// Load expo-router
import 'expo-router/entry';
